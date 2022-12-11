// const { Server } = require('socket.io');

const { Worker } = require("worker_threads");

// const worker = new Worker('./test-worker.js');
// worker.on('pong', (data) => console.log(data));
// worker.postMessage('ping', {id: 123});

// const io = new Server({
//     cors: {
//         origin: "http://localhost:8080",
//         methods: ["GET", "POST"]
//     }
// });

// io.listen(3000);

const worker = new Worker('./test-worker.js');
worker.on('message', (data) => {
    console.log(data);
});

worker.postMessage({id: 123});