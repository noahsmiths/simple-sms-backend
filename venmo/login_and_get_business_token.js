require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

axios.defaults.headers.common['User-Agent'] = "Venmo/10.3.0 (iPad; iOS 13.5; Scale/2.0)";
axios.defaults.headers.common['device-id'] = "11111111-1111-1111-1111-111111111111";

const main = async () => {
    try {
        let userLogin = await axios({
            method: 'POST',
            url: 'https://api.venmo.com/v1/oauth/access_token',
            data: {
                "password": process.env.VENMO_PASSWORD,
                "phone_email_or_username": process.env.VENMO_EMAIL,
                "client_id": "1"
            }
        });

        console.log(`Person Account Token: ${userLogin.data.access_token}`);
        fs.writeFileSync("./.venmo_personal_account_id", userLogin.data.user.id);
        fs.writeFileSync("./.venmo_personal_account_token", userLogin.data.access_token);

        let identities = await axios({
            method: 'GET',
            url: 'https://api.venmo.com/v1/users/identities',
            headers: {
                "Authorization": `Bearer ${userLogin.data.access_token}`
            },
        });
        
        let businessTokenGrant = await axios({
            method: 'POST',
            url: 'https://api.venmo.com/v1/oauth/token',
            headers: {
                "Authorization": `Bearer ${userLogin.data.access_token}`
            },
            data: {
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                "managed_user_id": identities.data.data.identities[1].external_id,
                "subject_token_type": "urn:ietf:params:oauth:token-type:access_token"
            }
        });

        console.log(`Business Account Token: ${businessTokenGrant.data.access_token}`);
        fs.writeFileSync("./.venmo_business_account_id", identities.data.data.identities[1].external_id);
        fs.writeFileSync("./.venmo_business_account_token", businessTokenGrant.data.access_token);
    } catch (e) {
        console.error(e);
    }
}

main();