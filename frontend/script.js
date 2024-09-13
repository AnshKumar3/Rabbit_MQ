document.getElementById('repoForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const repoUrl = document.getElementById('repoUrl').value;
    const projectType = document.getElementById('projectType').value;
    const outputDiv = document.getElementById('output');

    try {
        const response = await fetch('http://localhost:3000/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ repoUrl, projectType })
        });

        if (response.ok) {
            const text = await response.text();
            outputDiv.innerHTML = text;
            outputDiv.scrollTop = outputDiv.scrollHeight; // Auto-scroll to the bottom
        } else {
            outputDiv.innerHTML = 'Error: ' + response.statusText;
        }
    } catch (error) {
        outputDiv.innerHTML = 'Error: ' + error.message;
    }
});

// Establish SSE connection
const eventSource = new EventSource('http://localhost:3001/run'); // Update to match the consumer port

eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);

    if (data.type === 'tunnel') {
        const outputDiv = document.getElementById('output');
        outputDiv.innerHTML += `<p>Tunnel Info: <a href="${data.message}">${data.message}</a></p>`; // Append new messages
        outputDiv.scrollTop = outputDiv.scrollHeight; // Auto-scroll to the bottom
    } else if (data.type === 'logs') {
        const logsDiv = document.getElementById('logs');
        logsDiv.innerHTML += `${data.message}<br>`; // Append new logs
        logsDiv.scrollTop = logsDiv.scrollHeight; // Auto-scroll to the bottom
    }
};

eventSource.onerror = function() {
    console.error('EventSource failed.');
};
