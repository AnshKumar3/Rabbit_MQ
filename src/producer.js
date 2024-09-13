const express = require('express');
const cors = require('cors'); // Import CORS
const { connectRabbitMQ, getChannel } = require('./rabbitmq');
const config = require('../config/config');

const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json());

let channel;

connectRabbitMQ().then((ch) => {
    channel = ch;
});

app.post('/run', async (req, res) => {
    const { repoUrl, projectType } = req.body;

    if (!repoUrl || !projectType) {
        return res.status(400).send('Repository URL and project type are required');
    }

    const message = { repoUrl, projectType };

        channel.sendToQueue(config.queueName, Buffer.from(JSON.stringify(message)));
        console.log('Message sent to queue:', message);
        res.send('Project details added to queue');
});

const clients = [];

// SSE endpoint for streaming events to the frontend
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    res.write(`data: ${JSON.stringify({ type: 'connection', message: 'Connected to SSE' })}\n\n`);

    req.on('close', () => {
        console.log('Connection closed');
        clients = clients.filter(client => client.id !== clientId);
    });
});

// Endpoint to broadcast messages to SSE clients
app.post('/broadcast', (req, res) => {
    const { message } = req.body;

    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
    });

    res.send('Message broadcasted to SSE clients');
});

app.listen(3000, () => {
    console.log('Producer server listening on port 3000');
});
