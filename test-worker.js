const { parentPort } = require('worker_threads');

parentPort.on('message', (data) => {
    // console.log(data);
    test().then(() => {
        parentPort.postMessage(data.id);
    });
});

function test() {
    return new Promise(res => setTimeout(res, 5000));
}