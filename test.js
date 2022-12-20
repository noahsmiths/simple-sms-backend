// const { Server } = require('socket.io');

// const { Worker } = require("worker_threads");

// // const worker = new Worker('./test-worker.js');
// // worker.on('pong', (data) => console.log(data));
// // worker.postMessage('ping', {id: 123});

// // const io = new Server({
// //     cors: {
// //         origin: "http://localhost:8080",
// //         methods: ["GET", "POST"]
// //     }
// // });

// // io.listen(3000);

// const worker = new Worker('./test-worker.js');
// worker.on('message', (data) => {
//     console.log(data);
// });

// worker.postMessage({id: 123});

const SMSActivate = require('./phone-number/SMSActivate');

(async function() {
    const api = new SMSActivate('PRIVATE_KEY_HERE', 'orderId');

    let t = await api.getNumber('am', 12, 1200000);
    console.log(t);
})()