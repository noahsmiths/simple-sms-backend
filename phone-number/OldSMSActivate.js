const axios = require('axios');
const API_URL = 'https://api.sms-activate.org/stubs/handler_api.php';

class SMSActivate {
    #apiKey
    #client

    constructor(key) {
        this.#apiKey = key;

        this.#client = axios.create({
            baseURL: API_URL,
        });
    }

    #callAPIRoute(route, data) {
        return this.#client({
            method: 'POST',
            url: route,
            params: {
                api_key: this.#apiKey,
                ...data
            }
        });
    }

    getNumber(service) {
        return new Promise((resolve, reject) => {
            this.#callAPIRoute('/', {
                
            })
        });
    }
}