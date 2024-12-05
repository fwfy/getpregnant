require('dotenv').config()
const express = require('express');
const app = express();
const f = require("@fwfy/futil");
const kdb = new f.JSONDB("./kdb.json", true, 30000);
const { randomBytes, createHash } = require('crypto');
const tld = ".is-a.pregnant.horse";
const domainUpdateTimeout = parseFloat(process.env["DOMAIN_COOLDOWN"]) || 10;
const { Cloudflare } = require('cloudflare');
const cloudflare = new Cloudflare({
    apiToken: process.env.CF_API_KEY
});

app.use(express.urlencoded({ extended: true }));

if(!kdb.domains) kdb.domains = {};
if(!kdb.provisionKey || process.env.REGEN_PKEY == 1) {
    let provisionKey = randomBytes(16).toString('hex');
    
    console.log(`NOTICE: There was no provisionKey set in kdb.json, so a new one has been created.\n\nTHIS WILL ONLY BE SHOWN ONCE, and you CANNOT retrieve it from the db file afterwards.\nIf you lose it, you will be able to regenerate it by running this script with the environment variable 'REGEN_PKEY=1'`);
    console.log(`NEW KEY: ${provisionKey}`);
    kdb.provisionKey = createHash("sha512").update(provisionKey).digest('hex');
    kdb.jdb.save();
    if(process.env.REGEN_PKEY == 1) process.exit();
}

app.get("/", (req, res) => {
    res.end("GPSrv Domain Manager");
});

app.get("/info", (req, res) => {
    res.end(`# of currently provisioned domains: ${Object.keys(kdb.domains).length}`);
});

app.get('/query', (req, res) => {
    if(!req.query.name) {
        res.status(400);
        return res.end(`Bad Request: missing name query param`);
    }
    let data = kdb.domains[req.query.name] || false;
    if(!data) {
        res.status(404);
        return res.end(`Not Found`);
    }
    console.log(data);
    res.end(data.dest);
});

app.post("/update", (req, res) => {
    let auth = req.get("Authorization");
    let hash = createHash("sha512").update(auth).digest('hex');
    let subdomain = req.body.subdomain;
    let dest = req.body.dest;
    if(!subdomain) {
        res.status(400);
        return res.end(`Bad Request: missing subdomain`);
    }
    if(!auth || !kdb.domains[subdomain] || hash != kdb.domains[subdomain].subKeyHash) {
        res.status(401);
        return res.end(`Unauthorized.`);
    }
    if(Date.now() - kdb.domains[subdomain].lastModified < domainUpdateTimeout*60000) { // domainUpdateTimeout is specified as a number of minutes in .env
        res.status(429);
        return res.end("Too Many Requests");
    }

});

app.post("/provision", async (req, res) => {
    if(req.get("Authorization")) {
        let hash = createHash("sha512").update(req.get("Authorization")).digest('hex');
        if(hash == kdb.provisionKey) {
            let data = req.body;
            if(!data.subdomain) {
                res.status(400);
                return res.end(`Bad Request: missing subdomain`);
            }
            if(!data.dest) {
                res.status(400);
                return res.end(`Bad Request: missing destination`);
            }
            let subKey = randomBytes(16).toString('hex');
            let subKeyHash = createHash("sha512").update(subKey).digest('hex');
            kdb.domains[data.subdomain] = {
                subKeyHash,
                dest: data.dest,
                lastModified: 0
            }
            await cloudflare.dns.records.create({
                type: "A",
                content: data.dest,
                name: `${data.subdomain}${tld}`,
                comment: `Automatically created by GetPregnant on ${Date.now()} for user ${subKeyHash.substr(0,16)}.`,
                proxied: false,
                zone_id: process.env.CF_ZONE_ID
            });
            res.end(`Provisioned domain ${data.subdomain}${tld}. Key: ${subKey}`);
        } else {
            res.status(401);
            res.end(`Unauthorized.`);    
        }
    } else {
        res.status(401);
        res.end(`Unauthorized.`);
    }
});

app.listen(20001);