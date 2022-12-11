require('dotenv').config();
const { parentPort } = require('worker_threads');
const SMSActivateAPI = require('./SMSActivate');

const client = new SMSActivateAPI(process.env.SMS_ACTIVATE_KEY);

const activeInstances = [];

parentPort.on('get-number', (data) => {
    client.getNumber(data.service)
        .then((instance) => {
            parentPort.postMessage('')
        })
        .catch((err) => {
            parentPort.postMessage('error-getting-number', {
                orderId: data.orderId
            });
        });
});

parentPort.on('monitor-number', (data) => {
    
});

parentPort.on('cancel-number', (data) => {

});