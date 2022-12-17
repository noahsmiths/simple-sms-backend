const socket = io('http://localhost:3000');
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

let orderId;

socket.on('order-created', (data) => {
    orderId = data.orderId;

    console.log(`Session ${orderId} started`);

    venmo.generatePaymentLink('simple-sms', 20, `Order:Netflix:${orderId}`);
    venmo.openPaymentWindow();
});

socket.on('order-confirmed', () => {
    console.log('Order has been confirmed!');
    venmo.closePaymentWindow();
});

socket.on('invalid-payment', () => {
    alert("INVALID PAYMENT");
})

class VenmoClientAPI {
    #paymentLink;
    #paymentWindow;
    #baseURL = isMobile ? "https://venmo.com/" : "https://account.venmo.com/pay";

    generatePaymentLink = (recipient, amountInCents, note) => {
        let amountInDollars = amountInCents.toString();
        
        if (amountInDollars.length > 2) {
            amountInDollars = amountInDollars.slice(0, amountInDollars.length - 2) + "." + amountInDollars.slice(amountInDollars.length - 2);
        } else {
            amountInDollars = "0." + amountInDollars;
        }

        this.#paymentLink = `${this.#baseURL}?txn=pay&audience=private&recipients=${recipient}&amount=${amountInDollars}&note=${encodeURIComponent(note)}`;
        return this.#paymentLink;
    }

    openPaymentWindow = (height = 700, width = 400) => {
        if (!this.#paymentLink) throw new Error("You must call the generatePaymentLink method before opening a window!");

        const y = window.top.outerHeight / 2 + window.top.screenY - (height / 2);
        const x = window.top.outerWidth / 2 + window.top.screenX - (width / 2);
        this.#paymentWindow = window.open(this.#paymentLink, 'venmo', `popup width=${width}, height=${height}, top=${y}, left=${x}`);
    }

    closePaymentWindow = () => {
        if (!this.#paymentWindow) return "No window open.";
        
        this.#paymentWindow.close();
        this.#paymentWindow = null;
    }
}

const venmo = new VenmoClientAPI();

function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }

function startOrder() {
    // socket.emit('create-order');
    orderId = uuidv4();

    console.log(`Session ${orderId} started`);

    venmo.generatePaymentLink('simple-sms', 99, `Order:Google:${orderId}`);
    venmo.openPaymentWindow();
}