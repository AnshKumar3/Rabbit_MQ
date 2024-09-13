const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import CORS
const { connectRabbitMQ } = require('./rabbitmq');
const config = require('../config/config');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3001;

const Docker = require('dockerode');
const docker = new Docker();
let channel;
let processing = false;

let clients = []; // SSE clients to broadcast tunnel URL
function sendEventToAllClients(event) {
    clients.forEach(client => client.res.write(`data: ${JSON.stringify(event)}\n\n`));
}
// Pool of available ports
const availablePorts = Array.from({ length: config.maxPorts }, (_, i) => config.startPort + i);

app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

// SSE endpoint to send events to the frontend
app.get('/run', (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = uuidv4();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    // Send initial message to confirm connection
    res.write(`data: ${JSON.stringify({ type: 'connection', message: 'Connected to SSE' })}\n\n`);

    // Remove the client when the connection closes
    req.on('close', () => {
        clients = clients.filter(client => client.id !== clientId);
    });
});

// Broadcast tunnel URL to all connected clients
function broadcastTunnelUrl(tunnelUrl) {
    console.log(`Broadcasting tunnel URL: ${tunnelUrl}`); // Add this to verify
    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify({ type: 'tunnel', message: tunnelUrl })}\n\n`);
    });
}

// Endpoint to receive tunnel URL from the worker and broadcast it
app.post('/tunnel', (req, res) => {
    const { containerName, tunnelUrl } = req.body;
    console.log(`Received tunnel URL for container ${containerName}: ${tunnelUrl}`);

    // Broadcast the tunnel URL to all SSE clients
    broadcastTunnelUrl(tunnelUrl);

    res.send({ tunnelUrl });
});

// Connect to RabbitMQ and start consuming messages
connectRabbitMQ().then((ch) => {
    channel = ch;
    consumeQueue();
});

// Consumes messages from the queue
async function consumeQueue() {
    channel.consume(config.queueName, async (msg) => {
        if (msg !== null && !processing) {
            processing = true;

            const content = JSON.parse(msg.content.toString());
            console.log('Processing message:', content);

            const { repoUrl, projectType } = content;
            await handleContainer(repoUrl, projectType);

            channel.ack(msg); // Acknowledge message after processing
            processing = false;
        }
    });
}

// Function to handle container creation and project setup
async function handleContainer(repoUrl, projectType) {
    if (!repoUrl || !projectType) {
        console.error('Invalid repository URL or project type');
        return;
    }

    if (availablePorts.length === 0) {
        console.error('No available ports');
        return;
    }

    try {
        const containerName = `container_${uuidv4()}`;
        const hostPort = availablePorts.shift();

        let exposedPort, portBindings;
        if (projectType === 'vite') {
            exposedPort = '5173/tcp';
            portBindings = { '5173/tcp': [{ HostPort: `${hostPort}` }] };
        } else if (projectType === 'react') {
            exposedPort = '3000/tcp';
            portBindings = { '3000/tcp': [{ HostPort: `${hostPort}` }] };
        } else {
            console.error('Invalid project type');
            return;
        }

        const container = await docker.createContainer({
            Image: 'custom-node-cloudflared',
            Cmd: ['sh', '-c', 'while true; do sleep 1000; done'],
            Tty: true,
            WorkingDir: '/app',
            name: containerName,
            ExposedPorts: { [exposedPort]: {} },
            HostConfig: {
                PortBindings: portBindings,
                NetworkMode: config.dockerNetwork
            }
        });

        await container.start();
        console.log(`Container ${containerName} started on port ${hostPort}`);

        // Start Cloudflare tunnel before cloning the repository
        const tunnelUrl = await startCloudflareTunnel(container, exposedPort);
        console.log(`Cloudflare tunnel available at: ${tunnelUrl}`);

        // Send tunnel URL to the frontend via HTTP server
        await sendTunnelUrl(containerName, tunnelUrl);
sendEventToAllClients(` Access it at <a href="${tunnelUrl}" target="_blank">${tunnelUrl}</a>. Note: the server takes two minutes to spin up.`)

        // Setup project after the tunnel is available
        await setupProjectInContainer(container, repoUrl, projectType, tunnelUrl);

    } catch (error) {
        console.error('Error starting container:', error);
    }
}

// Function to start Cloudflare tunnel for the container
async function startCloudflareTunnel(container, exposedPort) {
    return new Promise(async (resolve, reject) => {
        const cloudflaredCmd = `cloudflared tunnel --url http://localhost:${exposedPort.split('/')[0]}`;
    
        const cloudflaredExec = await container.exec({
            Cmd: ['sh', '-c', cloudflaredCmd],
            AttachStdout: true,
            AttachStderr: true
        });

        const cloudflaredStream = await cloudflaredExec.start();

        cloudflaredStream.on('data', (data) => {
            const log = data.toString();
            console.log('Cloudflared log:', log);

            // Look for the Cloudflare tunnel URL in the logs
            const tunnelUrlMatch = log.match(/https:\/\/[^\s]+trycloudflare.com/);
        
            if (tunnelUrlMatch) {
                const tunnelUrl = tunnelUrlMatch[0];
                console.log(`Cloudflare tunnel created: ${tunnelUrl}`);
                resolve(tunnelUrl);
            }
        });

        cloudflaredStream.on('end', () => {
            console.log('Cloudflared tunnel process ended');
            reject(new Error('Cloudflared tunnel process ended before obtaining URL'));
        });
    });
}

// Function to send tunnel URL to the HTTP server
async function sendTunnelUrl(containerName, tunnelUrl) {
    try {
        await fetch(`http://localhost:${port}/tunnel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ containerName, tunnelUrl })
        });
    } catch (error) {
        console.error('Error sending tunnel URL:', error);
    }
}

// Function to set up the project inside the container
async function setupProjectInContainer(container, repoUrl, projectType, tunnelUrl) {
    console.log(`Setting up project: ${projectType} with repository ${repoUrl}`);

    let installAndRunCmd;
    if (projectType === 'vite') {
        installAndRunCmd = `npm cache clean --force && apk add git && git clone ${repoUrl} /app && cd /app && npm install && npm run build && npm run dev -- --host`;
    } else if (projectType === 'react') {
        installAndRunCmd = `npm cache clean --force && apk add git && git clone ${repoUrl} /app && cd /app && npm install && npm run build && npm start`;
    }

    const execInstance = await container.exec({
        Cmd: ['sh', '-c', installAndRunCmd],
        AttachStdout: true,
        AttachStderr: true
    });

    const execStream = await execInstance.start();

    execStream.on('data', (data) => {
        console.log(data.toString());
        sendEventToAllClients({ type: 'logs', message: data.toString() });
        

    });

    execStream.on('end', () => {
        console.log('Repository cloned and project set up');
        console.log(`Project running. Access it via Cloudflare tunnel: ${tunnelUrl}`);
    });
}

// Start the HTTP server
app.listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
});
