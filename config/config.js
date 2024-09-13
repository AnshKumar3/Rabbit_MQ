require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
    queueName: process.env.QUEUE_NAME || 'project_queue',
    dockerNetwork: process.env.DOCKER_NETWORK || 'my_custom_network',
    maxPorts: parseInt(process.env.MAX_PORTS) || 10,
    startPort: parseInt(process.env.START_PORT) || 3005
};
