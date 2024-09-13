const amqp = require('amqplib');
const config = require('../config/config');

let channel = null;

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(config.rabbitmqUrl);
        channel = await connection.createChannel();
        await channel.assertQueue(config.queueName, { durable: true });
        console.log('Connected to RabbitMQ');
        return channel;
    } catch (error) {
        console.error('Error connecting to RabbitMQ:', error);
    }
}

function getChannel() {
    if (!channel) {
        throw new Error('RabbitMQ channel not initialized. Call connectRabbitMQ() first.');
    }
    return channel;
}

module.exports = { connectRabbitMQ, getChannel };
