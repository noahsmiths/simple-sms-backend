class VenmoClientAPI {
    #paymentLink;
    #paymentWindow;

    generatePaymentLink = (recipient, amountInCents, note) => {
        let amountInDollars = amountInCents.toString();
        
        if (amountInDollars.length > 2) {
            amountInDollars = amountInDollars.slice(0, amountInDollars.length - 2) + "." + amountInDollars.slice(amountInDollars.length - 2);
        } else {
            amountInDollars = "0." + amountInDollars;
        }

        this.#paymentLink = `https://venmo.com/?txn=pay&audience=private&recipients=${recipient}&amount=${amountInDollars}&note=${encodeURIComponent(note)}`;
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

module.exports = VenmoClientAPI;