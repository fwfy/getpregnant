const express = require('express');
const app = express();
const f = require("@fwfy/futil");
const kdb = new f.JSONDB("./kdb.json", true, 30000);

if(!kdb.keys) kdb.keys = {};

