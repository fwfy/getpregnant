const tld = ".is-a.pregnant.horse";

const express = require('express');
const f = require("@fwfy/futil");
const { randomBytes, createHash } = require('crypto');
const { Cloudflare } = require('cloudflare');

require('dotenv').config()
const domainUpdateTimeout = parseFloat(process.env["DOMAIN_COOLDOWN"]) || 10;
const kdb = new f.JSONDB("./kdb.json", true, 30000);
const app = express();
const cloudflare = new Cloudflare({
    apiToken: process.env.CF_API_KEY
});

app.use(express.urlencoded({ extended: true }));

if (!kdb.domains) kdb.domains = {};
if (!kdb.provisionKey || process.env.REGEN_PKEY == 1) {
    let provisionKey = randomBytes(16).toString('hex');

    console.log(`NOTICE: There was no provisionKey set in kdb.json, so a new one has been created.\n\nTHIS WILL ONLY BE SHOWN ONCE, and you CANNOT retrieve it from the db file afterwards.\nIf you lose it, you will be able to regenerate it by running this script with the environment variable 'REGEN_PKEY=1'`);
    console.log(`NEW KEY: ${provisionKey}`);
    kdb.provisionKey = createHash("sha512").update(provisionKey).digest('hex');
    kdb.jdb.save();
    if (process.env.REGEN_PKEY == 1) process.exit();
}

app.get("/", (req, res) => {
    res.end("GPSrv Domain Manager");
});

app.get("/info", (req, res) => {
    res.end(`# of currently provisioned domains: ${Object.keys(kdb.domains).length}`);
});

app.get('/query', (req, res) => {
    if (!req.query.name) {
        res.status(400);
        return res.end(`Bad Request: missing required parameters (name)`);
    }

    let data = kdb.domains[req.query.name] || false;
    if (!data) {
        res.status(404);
        return res.end(`Not Found`);
    }

    res.end(data.dest);
});

app.post("/update", async (req, res) => {
    let auth = req.get("Authorization");
    let hash = createHash("sha512").update(auth).digest('hex');
    let subdomain = req.body.subdomain;
    let dest = req.body.dest;
    if (!subdomain || !dest) {
        res.status(400);
        return res.end(`Bad Request: missing required parameters (subdomain, dest)`);
    }

    if (!dest.match(/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/)) {
        res.status(400);
        return res.end(`Bad Request: not a valid IPV4 address`);
    }

    if (!auth || !kdb.domains[subdomain] || hash != kdb.domains[subdomain].subKeyHash) {
        res.status(401);
        return res.end(`Unauthorized.`);
    }

    if (Date.now() - kdb.domains[subdomain].lastModified < domainUpdateTimeout * 60000) { // domainUpdateTimeout is specified as a number of minutes in .env
        res.status(429);
        return res.end("Too Many Requests");
    }

    let domain = kdb.domains[subdomain];
    domain.lastModified = Date.now();
    await cloudflare.dns.records.edit(domain.cfRecordID, {
        content: dest,
        proxied: false,
        zone_id: process.env.CF_ZONE_ID
    });
    domain.dest = dest;
    res.end(`OK`);
});

app.post("/provision", async (req, res) => {
    try {
        if (!req.get("Authorization")) {
            res.status(401);
            res.end(`Unauthorized.`);
            return;
        }

        let hash = createHash("sha512").update(req.get("Authorization")).digest('hex');
        if (hash != kdb.provisionKey) {
            res.status(401);
            res.end(`Unauthorized.`);
        }

        let data = req.body;
        if (!data.subdomain || !data.dest) {
            res.status(400);
            return res.end(`Bad Request: missing required parameters (subdomain, dest)`);
        }

        let subKey = randomBytes(16).toString('hex');
        let subKeyHash = createHash("sha512").update(subKey).digest('hex');

        let record = await cloudflare.dns.records.create({
            type: "A",
            content: data.dest,
            name: `${data.subdomain}${tld}`,
            comment: `Automatically created by GetPregnant on ${Date.now()} for user ${subKeyHash.substr(0, 16)}.`,
            proxied: false,
            zone_id: process.env.CF_ZONE_ID
        });
        kdb.domains[data.subdomain] = {
            subKeyHash,
            dest: data.dest,
            lastModified: 0,
            cfRecordID: record.id
        }
        res.end(`Provisioned domain ${data.subdomain}${tld}. Key: ${subKey}`);
    } catch (e) {
        console.log(e);
        res.status(500);
        res.end("Internal Server Error");
    }
});

app.listen(20001);