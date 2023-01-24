require('dotenv').config();
const axios = require('axios');
const serviceMappings = require('./service-mappings.json');
const express = require('express');

const apiKey = process.env.SMS_ACTIVATE_KEY;
const countryCode = 12; // sms-activate country code for US (virtual)

const getCountries = () => {
    return new Promise((resolve, reject) => {
        axios({
                method: "GET",
                url: `https://api.sms-activate.org/stubs/handler_api.php?api_key=${apiKey}&action=getNumbersStatus&country=${countryCode}`,
                responseType: "text",
                headers: {
                    "accept-encoding": "none"
                }
            })
            .then(async (response) => {
                let services = JSON.parse(response.data);

                let serviceList = [];

                for (let service in services) {
                    if (services[service] == '0') continue;

                    let image = await axios({
                        method: "GET",
                        url: "https://smsactivate.s3.eu-central-1.amazonaws.com/assets/ico/" + service.replace("_", "") + ".webp",
                        responseType: "arraybuffer"
                    });

                    let serviceObj = {
                        service_name: serviceMappings[service.substring(0, 2)],
                        service_id: service.substring(0, 2),
                        service_logo_encoded: image.data.toString('base64'),
                        service_price: 99
                    }

                    serviceList.push(serviceObj);
                }

                resolve(serviceList);
            })
            .catch((err) => {
                console.log(err);
            });
    });
}

const app = express();
const port = 8888;

app.get('/', async (req, res) => {
    res.json(await getCountries());
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})