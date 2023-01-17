const axios = require('axios');
const { EventEmitter } = require('events');

const SMSActivate = require('./SMSActivate');
const FiveSim = require('./FiveSim');

const config = require('./config.json');
const services = config.services;

class PhoneAPI extends EventEmitter {
    #SMSActivateAPIKey
    #FiveSimAPIKey
    #activeNumbers

    constructor(smsActivateKey, fiveSimKey) {
        super();

        this.#SMSActivateAPIKey = smsActivateKey;
        this.#FiveSimAPIKey = fiveSimKey;

        this.#activeNumbers = new Set();
    }

    getNumberByService(orderId, service) {
        return new Promise((resolve, reject) => {
            let serviceDetails = services?.[service];
            let provider = serviceDetails?.['provider_to_use'];
            let serviceId = serviceDetails?.[provider];
            let country = serviceDetails?.['country'];
            let validTime = serviceDetails?.['number_valid_time_in_ms'];
            let api;

            switch (provider) {
                case "sms_activate_id":
                    api = new SMSActivate(this.#SMSActivateAPIKey, orderId);
                break;
                case "5sim_id":
                    api = new FiveSim(this.#FiveSimAPIKey, orderId);
                break;
                default:
                    reject("Invalid service.");
                    return
                break;
            }

            api.getNumber(serviceId, country, validTime)
                .then((instance) => {
                    // this.#activeNumbers.add(instance);

                    // instance.on('messages-updated', (data) => {

                    // });

                    // instance.on('number-')

                    // resolve(instance.number);
                    resolve({
                        orderId: orderId,
                        smsInstance: instance,
                        number: instance.number,
                        provider: provider
                    });
                })
                .catch((err) => {
                    reject(err);
                })
        });
    }

    getSmsInstance(orderId, provider, providerId, number, expiresAt, messages) {
        return new Promise((resolve, reject) => {
            let api;

            switch (provider) {
                case "sms_activate_id":
                    api = new SMSActivate(this.#SMSActivateAPIKey, orderId);
                break;
                case "5sim_id":
                    api = new FiveSim(this.#FiveSimAPIKey, orderId);
                break;
                default:
                    reject("Invalid service.");
                    return;
                break;
            }

            api.providerId = providerId;
            api.number = number;
            api.expiresAt = expiresAt;
            api.messages = messages;

            api.startMonitoring();

            resolve(api);
        });
    }
}

module.exports = PhoneAPI;