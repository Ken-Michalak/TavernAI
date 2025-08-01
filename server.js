var express = require('express');
var app = express();
var fs = require('fs');
const readline = require('readline');
const open = require('open');
const uuid = require('uuid');
var rimraf = require("rimraf");
const multer  = require("multer");
const https = require('https');
const http = require('http');
//const PNG = require('pngjs').PNG;
const extract = require('png-chunks-extract');
const encode = require('png-chunks-encode');
const PNGtext = require('png-chunk-text');
const ExifReader = require('exifreader');
const url = require('url');
function isUrl(str) {
    try {
        new URL(str);
        return true;
    } catch (err) {
        return false;
    }
}
const sharp = require('sharp');
sharp.cache(false);
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const json5 = require('json5');
var sanitize_filename = require("sanitize-filename");
const { TextEncoder, TextDecoder } = require('util');
const utf8Encode = new TextEncoder();
const utf8Decode = new TextDecoder('utf-8', { ignoreBOM: true });
const config = require(path.join(process.cwd(), './config.conf'));
const server_port = config.port;
const whitelist = config.whitelist;
const whitelistMode = config.whitelistMode;
let listenIp = null;
if (config.listenIp) {
    // If an advanced user has set the listen IP we use it explicitly
    listenIp = config.listenIp;    
} else if (!whitelistMode || whitelist.length > 1) {
    // If whitelist mode is disabled OR there are multiple IPs in the whitelist
    // we listen on all interfaces.
    listenIp = '0.0.0.0';
} else {
    // Otherwise we listen on the loopback address only
    listenIp = '127.0.0.1';
}
if (!whitelistMode && ipaddr.parse(listenIp).range() !== 'loopback') {
    console.warn(
`WARNING: You have configured TavernAI to listen on an IP address that 
         is not a loopback address ('${listenIp}'), and you have not enabled 
         white list mode. This means that your TavernAI server will be 
         accessible from other computers on your network. If you do not want 
         this, please change the listenIp setting in your config.conf file or
         enable and configure white list mode.`
    );
}
const autorun = config.autorun;
const characterFormat = config.characterFormat;
const charaCloudMode = config.charaCloudMode;
const charaCloudServer = config.charaCloudServer;
const connectionTimeoutMS = config.connectionTimeoutMS;
const csrf_token = config.csrf_token;
global.BETA_KEY;
var Client = require('node-rest-client').Client;
var client = new Client();
var api_server = "http://127.0.0.1:5000/api";//"http://127.0.0.1:5000";
const api_novelai = "https://api.novelai.net";
const api_openai = "https://api.openai.com/v1";
const api_horde = "https://stablehorde.net/api";
const api_ollama = "http://127.0.0.1:11434"; // Default Ollama API URL
var hordeActive = false;
var hordeQueue;
var hordeData = {};
var hordeError = null;
var hordeTicker = 0;
var response_get_story;
var response_generate;
var response_generate_novel;
var response_generate_openai;
var response_generate_claude;
var request_promt;
var response_promt;
var response_characloud_loadcard;
var characters = {};
var character_i = 0;
var response_create;
var response_edit;
var response_dw_bg;
var response_getstatus;
var response_getstatus_novel;
var response_getstatus_openai;
var response_getstatus_claude;
var response_getstatus_ollama;
var response_getlastversion;
var api_key_novel;
var api_key_openai;
var api_key_claude;
var api_url_openai;
var model_ollama; // Variable to store Ollama model name
var is_colab = false;
var charactersPath = 'public/characters/';
var worldPath = 'public/worlds/';
var chatsPath = 'public/chats/';
var UserAvatarsPath = 'public/User Avatars/';
var roomsPath = 'public/rooms/';
// if (is_colab && process.env.googledrive == 2){
    // charactersPath = '/content/drive/MyDrive/TavernAI/characters/';
    // chatsPath = '/content/drive/MyDrive/TavernAI/chats/';
    // UserAvatarsPath = '/content/drive/MyDrive/TavernAI/User Avatars/';
// }
const jsonParser = express.json({limit: '100mb'});
const urlencodedParser = express.urlencoded({extended: true, limit: '100mb'});
// CSRF Protection //
const doubleCsrf = require('csrf-csrf').doubleCsrf;
const CSRF_SECRET = crypto.randomBytes(8).toString('hex');
const COOKIES_SECRET = crypto.randomBytes(8).toString('hex');
const { invalidCsrfTokenError, generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => CSRF_SECRET,
    cookieName: "X-CSRF-Token",
    cookieOptions: {
        httpOnly: true,
        sameSite: "strict",
        secure: false
    },
    size: 64,
    getTokenFromRequest: (req) => req.headers["x-csrf-token"]
});
app.get("/csrf-token", (req, res) => {
    res.json({
        "token": generateToken(res)
    });
});
app.get("/timeout", (req, res) => {
    res.json({
        "timeout": connectionTimeoutMS
    });
});
if (csrf_token) {
    app.use(cookieParser(COOKIES_SECRET));
    app.use(doubleCsrfProtection);
}
// CORS Settings //
const cors = require('cors');
const CORS = cors({
    origin: 'null',
    methods: ['OPTIONS']
});
if (csrf_token) {
    app.use(CORS);
}
app.use(function (req, res, next) { //Security
    let clientIp = req.connection.remoteAddress;
    let ip = ipaddr.parse(clientIp);
    //Check if the IP address is IPv4-mapped IPv6 address
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) {
      const ipv4 = ip.toIPv4Address().toString();
      clientIp = ipv4;
    } else {
      clientIp = ip;
      clientIp = clientIp.toString();
    }
    //clientIp = req.connection.remoteAddress.split(':').pop();
    if (whitelistMode === true && !whitelist.includes(clientIp)) {
        console.log('Forbidden: Connection attempt from '+ clientIp+'. If you are attempting to connect, please add your IP address in whitelist or disable whitelist mode in config.conf in root of TavernAI folder.\n');
        return res.status(403).send('<b>Forbidden</b>: Connection attempt from <b>'+ clientIp+'</b>. If you are attempting to connect, please add your IP address in whitelist or disable whitelist mode in config.conf in root of TavernAI folder.');
    }
    next();
});
app.use((req, res, next) => {
    if (req.url.startsWith('/characters/') && is_colab && process.env.googledrive == 2) {
        let requestUrl = url.parse(req.url);
        const filePath = path.join(charactersPath, decodeURIComponent(requestUrl.pathname.substr('/characters'.length)));
        fs.access(filePath, fs.constants.R_OK, (err) => {
            if (!err) {
                res.sendFile(filePath);
            } else {
                res.send('Character not found: ' + filePath);
                //next();
            }
        });
    } else {
        next();
    }
});
app.use((req, res, next) => {
    if (req.url.startsWith('/User%20Avatars/') && is_colab && process.env.googledrive == 2) {
        let requestUrl = url.parse(req.url);
        const filePath = path.join(UserAvatarsPath, decodeURIComponent(requestUrl.pathname.substr('/User%20Avatars'.length)));
        fs.access(filePath, fs.constants.R_OK, (err) => {
            if (!err) {
                res.sendFile(filePath);
            } else {
                res.send('Avatar not found: ' + filePath);
                //next();
            }
        });
    } else {
        next();
    }
});
app.use(express.static(__dirname + "/public", { refresh: true }));
app.use('/backgrounds', (req, res) => {
  const filePath = decodeURIComponent(path.join(process.cwd(), 'public/backgrounds', req.url.replace(/%20/g, ' ')));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).send('File not found');
      return;
    }
    //res.contentType('image/jpeg');
    res.send(data);
  });
});
app.use('/characters', (req, res) => {
    let filePath = decodeURIComponent(path.join(process.cwd(), charactersPath, req.url.replace(/%20/g, ' ')));
    filePath = filePath.split('?v=');
    filePath = filePath[0];
    fs.readFile(filePath, (err, data) => {
    if (err) {
        res.status(404).send('File not found');
        return;
    }
    //res.contentType('image/jpeg');
    res.send(data);
  });
});
app.use('/cardeditor', (req, res) => {
    const requestUrl = url.parse(req.url);
    const filePath = decodeURIComponent(path.join(process.cwd(), 'public/cardeditor', requestUrl.pathname.replace(/%20/g, ' ')));
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.status(404).send('File not found');
            return;
        }
        //res.contentType('image/jpeg');
        res.send(data);
    });
});
app.use('/User%20Avatars', (req, res) => {
    const requestUrl = url.parse(req.url);
    const filePath = decodeURIComponent(path.join(process.cwd(), UserAvatarsPath, requestUrl.pathname.replace(/%20/g, ' ')));
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.status(404).send('File not found ');
            return;
        }
        //res.contentType('image/jpeg');
        res.send(data);
    });
});
app.use(multer({dest:"uploads"}).single("avatar"));
app.get("/", function(request, response){
    response.sendFile(__dirname + "/public/index.html"); 
});
app.get("/notes/*", function(request, response){
    response.sendFile(__dirname + "/public"+request.url+".html"); 
});
app.post("/getlastversion", jsonParser, function(request, response_getlastversion = response){
    if(!request.body) return response_getlastversion.sendStatus(400);
    const repo = 'TavernAI/TavernAI';
    let req;
    req = https.request({
        hostname: 'github.com',
        path: `/${repo}/releases/latest`,
        method: 'HEAD'
    }, (res) => {
        if(res.statusCode === 302) {
            const glocation = res.headers.location;
            const versionStartIndex = glocation.lastIndexOf('@')+1;
            const version = glocation.substring(versionStartIndex);
            //console.log(version);
            response_getlastversion.send({version: version});
        }else{
            response_getlastversion.send({version: 'error'});
        }
    });
    req.on('error', (error) => {
        console.error(error);
        response_getlastversion.send({version: 'error'});
    });
    req.end();
});
//**************Kobold api
app.post("/generate", jsonParser, function(request, response_generate = response){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    request_promt = request.body.prompt;
    //console.log(request.body);
    var this_settings = { prompt: request_promt,
                        use_story:false,
                        use_memory:false,
                        use_authors_note:false,
                        use_world_info:false,
                        max_context_length: request.body.max_context_length
                        //temperature: request.body.temperature,
                        //max_length: request.body.max_length
                        };
    if(request.body.singleline) {
        this_settings.singleline = true
    }
    if(request.body.gui_settings == false){
        var sampler_order = [request.body.s1,request.body.s2,request.body.s3,request.body.s4,request.body.s5,request.body.s6,request.body.s7];
        this_settings = { prompt: request_promt,
                        use_story:false,
                        use_memory:false,
                        use_authors_note:false,
                        use_world_info:false,
                        max_context_length: request.body.max_context_length,
                        max_length: request.body.max_length,
                        rep_pen: request.body.rep_pen,
                        rep_pen_range: request.body.rep_pen_range,
                        rep_pen_slope: request.body.rep_pen_slope,
                        temperature: request.body.temperature,
                        tfs: request.body.tfs,
                        top_a: request.body.top_a,
                        top_k: request.body.top_k,
                        top_p: request.body.top_p,
                        typical: request.body.typical,
                        sampler_order: sampler_order
                        };
        if(request.body.singleline) {
            this_settings.singleline = true
        }
    }
    console.log(this_settings);
    var args = {
        data: this_settings,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/generate",args, function (data, response) {
        if(response.statusCode == 200){
            console.log(data);
            response_generate.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_generate.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_generate.send({error: true, error_message: data.detail.msg});
            } else {
                response_generate.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_generate.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
//**************WEBUI api
app.post("/generate_webui", jsonParser, function(request, response_generate){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    //console.log(request.body);
    let this_settings = {
        prompt: request.body.prompt,
        max_new_tokens: request.body.max_new_tokens,
        max_tokens: request.body.max_new_tokens,
        preset: 'None',
        do_sample: true,
        temperature: request.body.temperature,
        top_p: request.body.top_p,
        typical_p: request.body.typical_p,
        epsilon_cutoff: 0,
        eta_cutoff: 0,
        tfs: request.body.tfs,
        top_a: request.body.top_a,
        repetition_penalty: request.body.repetition_penalty,
        repetition_penalty_range: request.body.repetition_penalty_range,
        top_k: request.body.top_k,
        min_length: 0,
        no_repeat_ngram_size: request.body.no_repeat_ngram_size,
        num_beams: 1,
        penalty_alpha: 0,
        length_penalty: 1,
        early_stopping: false,
        mirostat_mode: 0,
        mirostat_tau: 5,
        mirostat_eta: 0.1,
        seed: -1,
        add_bos_token: true,
        truncation_length: request.body.truncation_length,
        ban_eos_token: false,
        skip_special_tokens: true,
        stopping_strings: request.body.stopping_strings,
        stop: request.body.stopping_strings
    };
    console.log(this_settings);
    var args = {
        data: this_settings,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/completions",args, function (data, response) {
        if(response.statusCode == 200){
            console.log(data);
            response_generate.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_generate.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_generate.send({error: true, error_message: data.detail.msg});
            } else {
                response_generate.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_generate.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.post("/tokenizer_webui", jsonParser, function(request, response_tokenizer){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    //console.log(request.body);
    let this_data = {
        text: request.body.prompt
    };
    var args = {
        data: this_data,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/internal/encode",args, function (data, response) {
        if(response.statusCode == 200){
            response_tokenizer.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_tokenizer.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_tokenizer.send({error: true, error_message: data.detail.msg});
            } else {
                response_tokenizer.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_tokenizer.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.post("/savechat", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
     //const data = request.body;
    //console.log(request);
    //console.log(request.body.chat);
    //var bg = "body {background-image: linear-gradient(rgba(19,21,44,0.75), rgba(19,21,44,0.75)), url(../backgrounds/"+request.body.bg+");}";
    var dir_name = String(request.body.card_filename).replace(`.${characterFormat}`,'');
    let chat_data = request.body.chat;
    let jsonlData = chat_data.map(JSON.stringify).join('\n');
    fs.writeFile(chatsPath+dir_name+"/"+request.body.file_name+'.jsonl', jsonlData, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
            //response.send(err);
        }else{
            //response.redirect("/");
            response.send({result: "ok"});
        }
    });
});
app.post("/changechatname", jsonParser, function(request, response){
    try {
        let dir_name = String(request.body.character_filename).replace(`.${characterFormat}`,'');
        let filePath = chatsPath+dir_name+"/"+request.body.chat_filename+'.jsonl';
        //read
        let fileContents = fs.readFileSync(filePath, 'utf8');
        let lines = fileContents.split('\n');
        let firstLine = JSON.parse(lines[0]);
        firstLine.chat_name = request.body.chat_name;  
        lines[0] = JSON.stringify(firstLine);
        // Join updated lines 
        fileContents = lines.join('\n');
        //write
        //let chat_data = request.body.chat;
        //let jsonlData = chat_data.map(JSON.stringify).join('\n');
        fs.writeFileSync(filePath, fileContents);
        // Send response
        response.send({result: "ok"});
    }catch(err){
        console.log(err);
        return response.status(400).send(err);
    }
});
app.post("/getchat", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
     //const data = request.body;
    //console.log(request);
    //console.log(request.body.chat);
    //var bg = "body {background-image: linear-gradient(rgba(19,21,44,0.75), rgba(19,21,44,0.75)), url(../backgrounds/"+request.body.bg+");}";
    var dir_name = String(request.body.card_filename).replace(`.${characterFormat}`,'');
    fs.stat(chatsPath+dir_name, function(err, stat) {
        if(stat === undefined){
            fs.mkdirSync(chatsPath+dir_name);
            response.send({});
            return;
        }else{
            if(err === null){
                fs.stat(chatsPath+dir_name+"/"+request.body.file_name+".jsonl", function(err, stat) {
                    if (err === null) {
                        if(stat !== undefined){
                            fs.readFile(chatsPath+dir_name+"/"+request.body.file_name+".jsonl", 'utf8', (err, data) => {
                                if (err) {
                                  console.error(err);
                                  response.send(err);
                                  return;
                                }
                                //console.log(data);
                                const lines = data.split('\n');
                                // Iterate through the array of strings and parse each line as JSON
                                const jsonData = lines.filter(line => line && line.length).map(json5.parse);
                                response.send(jsonData);
                            });
                        }
                    }else{
                        response.send({});
                        //return console.log(err);
                        return;
                    }
                });
            }else{
                console.error(err);
                response.send({});
                return;
            }
        }
    });
});
app.post("/savechatroom", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
     //const data = request.body;
    //console.log(request);
    //console.log(request.body.chat);
    //var bg = "body {background-image: linear-gradient(rgba(19,21,44,0.75), rgba(19,21,44,0.75)), url(../backgrounds/"+request.body.bg+");}";
    var dir_name = String(request.body.filename);
    let chat_data = request.body.chat;
    let jsonlData = chat_data.map(JSON.stringify).join('\n');
    fs.writeFile(roomsPath+"/"+request.body.filename+'.jsonl', jsonlData, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
            //response.send(err);
        }else{
            //response.redirect("/");
            response.send({result: "ok"});
        }
    });
});
app.post("/getchatroom", jsonParser, function(request, response){
    // Expected: request.body.room_filename is the .jsonl file name (WITHOUT the extension) representing the room referred
    var dir_name = String(request.body.room_filename);
    fs.stat(roomsPath+dir_name+".jsonl", function(err, stat) {
        if(stat === undefined){
            fs.mkdirSync(roomsPath+dir_name+".jsonl");
            response.send({});
            return;
        }else{
            if(err === null){
                fs.stat(roomsPath+request.body.room_filename+".jsonl", function(err, stat) {
                    if (err === null) {
                        if(stat !== undefined){
                            fs.readFile(roomsPath+request.body.room_filename+".jsonl", 'utf8', (err, data) => {
                                if (err) {
                                  console.error(err);
                                  response.send(err);
                                  return;
                                }
                                //console.log(data);
                                const lines = data.split('\n');
                                // Iterate through the array of strings and parse each line as JSON
                                const jsonData = updateRoomsFormat(lines.map(json5.parse));
                                response.send(jsonData);
                            });
                        }
                    }else{
                        response.send({});
                        //return console.log(err);
                        return;
                    }
                });
            }else{
                console.error(err);
                response.send({});
                return;
            }
        }
    });
});
app.post("/getstatus", jsonParser, function(request, response_getstatus = response){
    if(!request.body) return response_getstatus.sendStatus(400);
    api_server = request.body.api_server;
    if(api_server.indexOf('localhost') != -1){
        api_server = api_server.replace('localhost','127.0.0.1');
    }
    var args = {
        headers: { "Content-Type": "application/json" }
    };
    client.get(api_server+"/v1/model",args, function (data, response) {
        if(response.statusCode == 200){
            if(data.result != "ReadOnly"){
                
                //response_getstatus.send(data.result);
            }else{
                data.result = "no_connection";
            }
        }else{
            data.result = "no_connection";
        }
        response_getstatus.send(data);
        //console.log(response.statusCode);
        //console.log(data);
        //response_getstatus.send(data);
        //data.results[0].text
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_getstatus.send({result: "no_connection"});
    });
});
app.post("/getstatus_webui", jsonParser, function(request, response_getstatus){
    if(!request.body) return response_getstatus.sendStatus(400);
    api_server = request.body.api_server_webui;
    if(api_server.indexOf('localhost') != -1){
        api_server = api_server.replace('localhost','127.0.0.1');
    }
    var args = {
        headers: { "Content-Type": "application/json" }
    };
    client.get(api_server+"/v1/internal/model/info",args, function (data, response) {
        if(response.statusCode == 200){
            if(data.result != "ReadOnly"){
                //response_getstatus.send(data.result);
            }else{
                data.result = "no_connection";
            }
        }else{
            data.result = "no_connection";
        }
        response_getstatus.send(data);
        //console.log(response.statusCode);
        //console.log(data);
        //response_getstatus.send(data);
        //data.results[0].text
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_getstatus.send({result: "no_connection"});
    });
});
function checkServer(){
    //console.log('Check run###################################################');
    api_server = 'http://127.0.0.1:5000/api';
    var args = {
        headers: { "Content-Type": "application/json" }
    };
    client.get(api_server+"/v1/model",args, function (data, response) {
        console.log(data.result);
        //console.log('###################################################');
        console.log(data);
    }).on('error', function (err) {
        console.log(err);
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        //console.log('errorrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr');
    });
}
//================================================================================================
//=  =====  =========================        =====================================================
//=   ===   =========================  ===========================================================
//=  =   =  =========================  ==============================  ===========================
//=  == ==  ===   ===  ==  = ========  ========  =  ==  = ====   ===    ==  ===   ===  = ====   ==
//=  =====  ==  =  ======     =======      ====  =  ==     ==  =  ===  =======     ==     ==  =  =
//=  =====  =====  ==  ==  =  =======  ========  =  ==  =  ==  ======  ===  ==  =  ==  =  ===  ===
//=  =====  ===    ==  ==  =  =======  ========  =  ==  =  ==  ======  ===  ==  =  ==  =  ====  ==
//=  =====  ==  =  ==  ==  =  =======  ========  =  ==  =  ==  =  ===  ===  ==  =  ==  =  ==  =  =
//=  =====  ===    ==  ==  =  =======  =========    ==  =  ===   ====   ==  ===   ===  =  ===   ==
//================================================================================================
function checkCharaProp(prop) {
  return (String(prop) || '')
      .replace(/[\u2018\u2019‘’]/g, "'")
      .replace(/[\u201C\u201D“”]/g, '"');
}
function charaFormatData(data){
    let name;
    if(data.ch_name === undefined){
        name = data.name;
    }else{
        name = data.ch_name;
    }
    name = checkCharaProp(name);
    if(name.length === 0){
        name = 'null';
    }
    let categories;
    let last_action_date;
    let create_date_online;
    let edit_date_online;
    if(data.create_date_online === undefined){
        create_date_online = Date.now();
    }else{
        create_date_online = data.create_date_online;
    }
    if(data.edit_date_online === undefined){
        edit_date_online = Date.now();
    }else{
        edit_date_online = data.edit_date_online;
    }
    if (data.last_action_date === undefined) {
        last_action_date = Date.now();
    } else {
        last_action_date = data.last_action_date;
    }
    let create_date_local;
    let edit_date_local;
    if(data.create_date_local === undefined){
        create_date_local = Date.now();
    }else{
        create_date_local = data.create_date_local;
    }
    if(data.edit_date_local === undefined){
        edit_date_local = Date.now();
    }else{
        edit_date_local = data.edit_date_local;
    }
    if (data.add_date_local === undefined) {
        add_date_local = Date.now();
    } else {
        add_date_local = data.add_date_local;
    }
    if(data.categories === undefined){
        categories = [];
    }else{
        categories = data.categories;
    }
    if(data.nsfw === undefined){
        data.nsfw = false;
    }else if(data.nsfw !== false){
        data.nsfw = true;
    }
    let short_description;
    if(data.short_description === undefined){
        short_description = "";
    }else{
        short_description = data.short_description;
    }
    let char = {public_id: checkCharaProp(data.public_id), public_id_short: checkCharaProp(data.public_id_short), user_name: checkCharaProp(data.user_name), user_name_view: checkCharaProp(data.user_name_view), name: name, description: checkCharaProp(data.description), short_description: checkCharaProp(short_description), personality: checkCharaProp(data.personality), first_mes: checkCharaProp(data.first_mes), chat: Date.now(), mes_example: checkCharaProp(data.mes_example), scenario: checkCharaProp(data.scenario), categories: categories, create_date_online: create_date_online, edit_date_online: edit_date_online, create_date_local: create_date_local, edit_date_local: edit_date_local, add_date_local: add_date_local, last_action_date: last_action_date, online: data.online, nsfw: data.nsfw, spec: "tavern_ai", spec_version: "1.0"};
    // Filtration
    if(data.public_id === undefined){ 
        char.public_id = uuid.v4().replace(/-/g, '');
    }else{
        if(data.public_id == "undefined" || data.public_id.length === 0){
            char.public_id = uuid.v4().replace(/-/g, '');
        }
    }
    if(data.public_id_short === undefined){
        delete char.public_id_short;
    }
    if(data.user_name === undefined){
        delete char.user_name;
    }
    if(data.user_name_view === undefined){
        delete char.user_name_view;
    }
    if(data.online != true){
        delete char.online;
    }
    return char;
}
// Function accepts an array of JSON objects representation of a chatroom (including metadata / the first line) as parameter argument, return an array of objects with updated format keeping track of character files
function updateRoomsFormat(content) {
    if("character_files" in content[0]) return content; // If JSON object has the key for the character files in the metadata (first line), assume update has been applied to content before

    const img_ext = ".png"; // Assume all character files are png files
    const updatedContent = [];
    let i = 0;
    for (const item of content) {
        if(i === 0) {
            updatedContent.push(item);
            delete updatedContent.character_names;
            updatedContent[i].character_files = [];
            for (const name of item.character_names)
                updatedContent[i].character_files.push(name + img_ext);
        }
        else {
            updatedContent.push(item);
            updatedContent[i].character_file = "" + updatedContent[i].name + img_ext;
        }
        i++;
    }
    updatedContent[0].updated = true; // Functions only as a flag and needs to be removed before taken as the chat metadata in the client side or front end processing.

    return updatedContent;
}
app.post("/createcharacter", urlencodedParser, async function(request, response){
    let target_img = setCardName(request.body.ch_name);
    if(!request.body) return response.sendStatus(400);
    if (!fs.existsSync(charactersPath+target_img+`.${characterFormat}`)){
        if(!fs.existsSync(chatsPath+target_img) )fs.mkdirSync(chatsPath+target_img);
        let filedata = request.file;
        var fileType = ".png";
        var img_file = "ai";
        var img_path = "public/img/";
        var char = charaFormatData(request.body);//{"name": target_img, "description": request.body.description, "personality": request.body.personality, "first_mes": request.body.first_mes, "avatar": 'none', "chat": Date.now(), "last_mes": '', "mes_example": ''};
        char = JSON.stringify(char);
        if(!filedata){
            await charaWrite('./public/img/fluffy.png', char, charactersPath + target_img, characterFormat, response);
        }else{
            img_path = "./uploads/";
            img_file = filedata.filename
            if (filedata.mimetype == "image/jpeg") fileType = ".jpeg";
            if (filedata.mimetype == "image/png") fileType = ".png";
            if (filedata.mimetype == "image/gif") fileType = ".gif";
            if (filedata.mimetype == "image/bmp") fileType = ".bmp";
            if (filedata.mimetype == "image/webp") fileType = ".webp";
            await charaWrite(img_path+img_file, char, charactersPath + target_img, characterFormat);
        }
        response.status(200).send({file_name: target_img});
        console.log("The file was saved.");
    }else{
        response.send("Error: A character with that name already exists.");
    }
    //console.log(request.body);
    //response.send(target_img);
    //response.redirect("https://metanit.com")
});
app.post("/createroom", urlencodedParser, async function(request, response){
    // let target_img = setCardName(request.body.ch_name);
    // since we are planning to re-use existing code, ch_name == filename (jsonl filename), since changing vvariables means we need
    // to also change the html file's form's input "name" attributes
    let target_file = request.body.ch_name; 
    let characterFiles = request.body.room_characters;
    let scenario = request.body.room_scenario;
    const fileExtension = ".jsonl";
    if(!request.body) return response.sendStatus(400);
    if(!request.body.room_characters) return response.sendStatus(400); // A room needs to have at least one character
    if (!fs.existsSync(roomsPath+target_file+fileExtension)){
        if(!scenario)
            await roomWrite(target_file, characterFiles);
        else
            await roomWrite(target_file, characterFiles, "You", Date.now(), "", "discr", scenario, []);
        response.status(200).send({file_name: target_file});
        console.log("The file was saved.");
    }else{
        response.send("Error: A room with that name already exists.");
    }
    //response.redirect("https://metanit.com")
    //console.log(request.body);
    //response.send(target_img);
});
app.post("/editcharacter", urlencodedParser, async function(request, response){
    try {
        if (!request.body)
            return response.sendStatus(400);
        let card_filename = request.body.filename;
        let filedata = request.file;
        var fileType = ".png";
        var img_file = "ai";
        var img_path = charactersPath;
        let old_char_data_json = await charaRead(charactersPath + card_filename);
        let old_char_data = JSON.parse(old_char_data_json);
        let new_char_data = request.body;
        let merged_char_data = Object.assign({}, old_char_data, new_char_data);
        var char = charaFormatData(merged_char_data);//{"name": request.body.ch_name, "description": request.body.description, "personality": request.body.personality, "first_mes": request.body.first_mes, "avatar": request.body.avatar_url, "chat": request.body.chat, "last_mes": request.body.last_mes, "mes_example": ''};
        char.chat = request.body.chat;
        char.create_date_local = request.body.create_date_local;
        if (old_char_data.add_date_local !== undefined) {
            char.add_date_local = old_char_data.add_date_local;
        } else {
            char.add_date_local = old_char_data.create_date_local;
        }
        char.edit_date_local = Date.now();
        char = JSON.stringify(char);
        let target_img = (card_filename).replace(`.${characterFormat}`, '');
        if (!filedata) {
            await charaWrite(img_path + card_filename, char, charactersPath + target_img, characterFormat);
        } else {
            //console.log(filedata.filename);
            img_path = "uploads/";
            img_file = filedata.filename;
            await charaWrite(img_path + img_file, char, charactersPath + target_img, characterFormat);
            //response.send('Character saved');
        }
        return response.status(200).send('Character saved');
    } catch (err) {
        console.log(err);
        return response.status(400).json({error: err.toString()});
    }
});
app.post("/deletecharacter", jsonParser, function(request, response){
    try {
        if (!request.body){
            return response.sendStatus(400).json({error: 'Validation body error'});
        }
        let filename = request.body.filename;
        rimraf.sync(charactersPath + filename);
        let dir_name = filename;
        rimraf.sync(chatsPath + dir_name.replace(`.${characterFormat}`, ''));
        return response.status(200).json({});
    } catch (err) {
        console.log(err);
        return response.status(400).json({error: err.toString()});
    }
});
app.post("/editroom", urlencodedParser, async function(request, response){
    try {
        if (!request.body)
            return response.sendStatus(400);
        let filename = request.body.filename;
        // let filedata = request.file; // No file data for rooms, since rooms do not have any avatar/image associated with them
        var fileExtension = ".jsonl";
        var img_file = "ai";
        var img_path = roomsPath;
        let old_room_data = await roomRead(filename + fileExtension);
        let old_room_metadata = old_room_data[0];
        let room_data_array = Object.values(old_room_data); // Convert JSON object (of JSON objects) into an array (of JSON objects)
        room_data_array.shift(); // The first line is metadata, so need to remove it first
        let room_chat_data = room_data_array;
        // let old_char_data = JSON.parse(old_char_data_json); // No need for this line, since roomRead() already returns a JSON object (not as string)
        let new_room_metadata = request.body;
        let merged_room_metadata = Object.assign({}, old_room_metadata, new_room_metadata);
        await roomWrite(filename, merged_room_metadata.character_files, merged_room_metadata.user_name, merged_room_metadata.create_date,
            merged_room_metadata.notes, merged_room_metadata.notes_types, merged_room_metadata.scenario, room_chat_data);
        return response.status(200).send('Room saved');
    } catch (err) {
        console.log(err);
        return response.status(400).json({error: err.toString()});
    }
});
// Expected filename without the extension
app.post("/deleteroom", jsonParser, function(request, response){
    try {
        if (!request.body){
            return response.sendStatus(400).json({error: 'Validation body error'});
        }
        let extension = ".jsonl";
        let filename = request.body.filename + extension;
        rimraf.sync(roomsPath + filename);
        // let dir_name = filename;
        // rimraf.sync(chatsPath + dir_name.replace(`.${characterFormat}`, ''));
        return response.status(200).json({});
    } catch (err) {
        console.log(err);
        return response.status(400).json({error: err.toString()});
    }
});
async function charaWrite(source_img, data, target_img, format = 'webp') {
    try {
        // Load the image in any format
        sharp.cache(false);
        switch (format) {
            case 'webp':
                const imageBuffer = fs.readFileSync(source_img);
                let stringByteArray = utf8Encode.encode(data).toString();
                const processedImage = await sharp(imageBuffer).resize(400, 600).webp({'quality': 95}).withMetadata({
                    exif: {
                        IFD0: {
                            UserComment: stringByteArray
                        }
                    }
                }).toBuffer();
                fs.writeFileSync(target_img + '.webp', processedImage);
                break;
            case 'png':
                var image = await sharp(source_img).resize(400, 600).toFormat('png').toBuffer();// old 170 234
                // Get the chunks
                var chunks = extract(image);
                var tEXtChunks = chunks.filter(chunk => chunk.name === 'tEXt');
                // Remove all existing tEXt chunks
                for (var tEXtChunk of tEXtChunks) {
                    chunks.splice(chunks.indexOf(tEXtChunk), 1);
                }
                // Add new chunks before the IEND chunk
                var base64EncodedData = Buffer.from(data, 'utf8').toString('base64');
                chunks.splice(-1, 0, PNGtext.encode('chara', base64EncodedData));
                fs.writeFileSync(target_img+'.png', new Buffer.from(encode(chunks)));
                break;
            default:
                break;
        }   
    } catch (err) {
        throw err;
    }
}
async function charaRead(img_url, input_format){
    let format;
    sharp.cache(false);
    if(input_format === undefined){
        if(img_url.indexOf('.webp') !== -1){
            format = 'webp';
        }else{
            format = 'png';
        }
    }else{
        format = input_format;
    }
    switch(format){
        case 'webp':
        try {
            sharp.cache(false);
            let char_data;
            const exif_data = await ExifReader.load(fs.readFileSync(img_url));
            if (exif_data['UserComment']['description']) {
                let description = exif_data['UserComment']['description'];
                try {
                    JSON.parse(description);
                    char_data = description;
                } catch {
                    const byteArr = description.split(",").map(Number);
                    const uint8Array = new Uint8Array(byteArr);
                    const char_data_string = utf8Decode.decode(uint8Array);
                    char_data = char_data_string;
                }
            } else {
                console.log('No description found in EXIF data.');
                return false;
            }
            return char_data;
        } catch (err) {
            console.log(err);
            return false;
        }
        case 'png':
            const buffer = fs.readFileSync(img_url);
            const chunks = extract(buffer);
            const textChunks = chunks.filter(function(chunk) {
                return chunk.name === 'tEXt';
            }).map(function (chunk) {
                return PNGtext.decode(chunk.data);
            });
            var base64DecodedData = Buffer.from(textChunks[0].text, 'base64').toString('utf8');
            return base64DecodedData;
        default:
            break;
    }
}
// // The function already appends the roomsPath before filedir (filename), and the .jsonl extension after the filedir
// async function roomWrite(filedir, characterNames, user_name="You", create_date="", notes="", notes_type="discr", scenario="", chat=[]) {
//     try {
//         const fileExtension = ".jsonl"; 
//         let fileContent = ''; // In string form
//         let createDate = create_date ? create_date : Date.now();
//         // let characterNamesArray = characterNames.isArray() ? characterNames : [characterNames];
//         if(!Array.isArray((characterNames)))
//             characterNames = [characterNames]; // Convert character names into an array if not already (happens when user selected only one character for a room)
//         let firstLine = '{"user_name":"'+user_name+'","character_names":'+JSON.stringify(characterNames)+',"create_date":'+createDate+',"notes":"'+notes+'","notes_type":"'+notes_type+'","scenario":"'+scenario+'"}';
//         fileContent += firstLine;
//         fileContent += chat.length ? "\n" : "";
//         chat.forEach(function(chat_msg, i) {
//             if(i < chat.length-1) // If the current chat message is not the last message
//                 fileContent += JSON.stringify(chat_msg) + "\n";
//             else
//                 fileContent += JSON.stringify(chat_msg);
//         });
//         fs.writeFileSync(roomsPath+filedir+fileExtension, fileContent);
//         // console.log(firstLine);
//     } catch (err) {
//         throw err;
//     }
// }
// The function already appends the roomsPath before filedir (filename), and the .jsonl extension after the filedir
async function roomWrite(filedir, characterFiles, user_name="You", create_date="", notes="", notes_type="discr", scenario="", chat=[]) {
    try {
        const fileExtension = ".jsonl"; 
        let fileContent = ''; // In string form
        let createDate = create_date ? create_date : Date.now();
        // let characterNamesArray = characterNames.isArray() ? characterNames : [characterNames];
        if(!Array.isArray((characterFiles)))
            characterFiles = [characterFiles]; // Convert character names into an array if not already (happens when user selected only one character for a room)

        notes = notes.replace(/\r\n|\n|"/g, function(match) {
            switch(match) {
                case '"':
                    return '\\"';
                default:
                    return '\\n';
            }
        });
        scenario = scenario.replace(/\r\n|\n|"/g, function(match) {
            switch(match) {
                case '"':
                    return '\\"';
                default:
                    return '\\n';
            }
        });

        let firstLine = '{"user_name":"'+user_name+'","character_files":'+JSON.stringify(characterFiles)+',"create_date":'+createDate+',"notes":"'+notes+'","notes_type":"'+notes_type+'","scenario":"'+scenario+'"}';
        fileContent += firstLine;
        fileContent += chat.length ? "\n" : "";
        chat.forEach(function(chat_msg, i) {
            if(i < chat.length-1) // If the current chat message is not the last message
                fileContent += JSON.stringify(chat_msg) + "\n";
            else
                fileContent += JSON.stringify(chat_msg);
        });
        fs.writeFileSync(roomsPath+filedir+fileExtension, fileContent);
        // console.log(firstLine);
    } catch (err) {
        throw err;
    }
}
app.post("/getcharacters", jsonParser, async function(request, response) {
    try {
        const files = await fs.promises.readdir(charactersPath);
        let imgFiles = files.filter(file => file.endsWith(`.${characterFormat}`));
        if(request.body && request.body.filename) {
            imgFiles = imgFiles
                .filter(file => file
                    .replace(/\.[^\.]*/, "").toLowerCase() === request.body.filename.toLowerCase()
                );
        }
        const characters = {};
        let i = 0;
        for (const item of imgFiles) {
            const imgData = await charaRead(charactersPath + item);
            let jsonObject;
            try {
                jsonObject = json5.parse(imgData);
                jsonObject.filename = item;
                characters[i] = jsonObject;
                i++;
            } catch (error) {
                if (error instanceof SyntaxError) {
                    console.error("Character info from index " +i+ " is not valid JSON!", error);
                } else {
                    console.error("An unexpected error loading character index " +i+ " occurred.", error);
                }
                console.error("Pre-parsed character data:");
                console.error(imgData);
            }
        }
        response.send(JSON.stringify(characters));
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});
// The function already appends the roomsPath before the roomFile value, expected with extension
async function roomRead(roomFile) {
    // console.log(roomsPath+roomFile);
    return fs.readFileSync(roomsPath+roomFile, {encoding: 'utf8'}).split('\n').map(json5.parse);
}
app.post("/getrooms", jsonParser, async function(request, response) {
    try {
        // const files = fs.readdirSync(roomsPath, {encoding: 'utf8'});
        const files = await fs.promises.readdir(roomsPath);
        let roomFiles = files.filter(file => file.endsWith('.jsonl'));
        if(request.body && request.body.filename) {
            roomFiles = roomFiles
                .filter(file => file
                    .replace(/\.[^\.]*/, "").toLowerCase() === request.body.filename.toLowerCase()
                );
        }
        const rooms = {};
        let i = 0;
        for (const item of roomFiles) {
            let jsonObject = {};
            // fs.readFileSync(roomsPath+item, 'utf8', (err, data) => {
            //     if (err) {
            //         response.send(err);
            //         return;
            //     }
            //     //console.log(data);
            //     const lines = data.split('\n');
            //     // Iterate through the array of strings and parse each line as JSON
            //     jsonObject.chat = lines.map(json5.parse);
            //     try {
            //         jsonObject.filename = item;
            //         rooms[i] = jsonObject;
            //         i++;
            //     } catch (error) {
            //         if (error instanceof SyntaxError) {
            //             console.error("Room info from index " +i+ " is not valid JSON!", error);
            //         } else {
            //             console.error("An unexpected error loading room index " +i+ " occurred.", error);
            //         }
            //         console.error("Pre-parsed room data:");
            //         console.error(jsonObject);
            //     }
            //     console.log(rooms);
            // });
            const stats = await fs.promises.stat(roomsPath+item);
            if(!stats.isDirectory())
            {
                jsonObject.chat = await roomRead(item);
                // jsonObject = (await fs.promises.readFile(roomsPath+item, {encoding: 'utf8'})).split('\n').map(json5.parse);
                jsonObject.filename = item;
                rooms[i] = jsonObject;
                // console.log(rooms);
                i++;
                // console.log(rooms);
            }
        }
        // console.log(rooms);
        response.send(JSON.stringify(rooms));
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});
app.post("/getworldnames", jsonParser, async function(request, response) {
    try {
        const files = await fs.promises.readdir(worldPath);
        const jsonFiles = files.filter(file => file.endsWith(".json"));
        const reply = { world_names: [] };
        jsonFiles.forEach(key => {
            reply.world_names.push(key.replace(/\.json$/g, ""));
        });
        response.send(JSON.stringify(reply));
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});
app.post("/saveworld", jsonParser, function(request, response){
    if(!request.body.world_name) {
        console.error("No world_name given in saveworld request");
        return response.sendStatus(400);
    }
    if(!request.body.data || !request.body.data.entries) {
        return response.sendStatus(406);
    }
    const path = worldPath + request.body.world_name + ".json";
    const data = JSON.stringify(request.body.data, null, "  ");
    fs.writeFile(path, data, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
        }else{
            response.send({result: "ok"});
        }
    });
});
app.post("/loadworld", jsonParser, function(request, response) {
    if(!request.body.world_name) {
        console.error("No world_name given in saveworld request");
        return response.sendStatus(400);
    }
    const path = worldPath + request.body.world_name + ".json";
    fs.stat(path, function(err, stat) {
        if(err === null) {
            fs.readFile(path, 'utf8', (err, data) => {
                if (err) {
                    console.error(err);
                    response.send(err);
                    return;
                }
                response.send(data);
            });
        } else {
            console.error(err);
            response.send({});
            return;
        }
    })
});
app.post("/deleteworld", jsonParser, function(request, response) {
    if(!request.body.world_name) {
        console.error("No world_name given in saveworld request");
        return response.sendStatus(400);
    }
    const path = worldPath + request.body.world_name.replace(/\.\.[\/\\]/g, "") + ".json";
    fs.stat(path, function(err, stat) {
        if(err === null) {
            fs.rm(path, () => {});
            response.send({result: "ok"});
        } else {
            response.send(err);
            return;
        }
    })
});
app.post("/importworld", urlencodedParser, async function(request, response){
    if(!request.body) { return response.sendStatus(400); }
    let filedata = request.file;
    if(filedata){
        fs.readFile('./uploads/'+filedata.filename, 'utf8', (err, data) => {
            if (err){
                console.log(err);
                response.send({error: "Unable to access file."});
                response.sendStatus(400);
                return;
            }
            const jsonData = json5.parse(data);
            let filename = request.body.filename
                .replace(/\.json$/, "").trim()
                .replace(/s+/g, " ")
                .replace(/ /g, "_");
            if(!jsonData.entries || typeof jsonData.entries !== "object") {
                return response.sendStatus(406);
            }
            fs.writeFile(worldPath + filename + ".json", data, 'utf8', function(err) {
                if(err) {
                    response.send(err);
                    return console.log(err);
                } else {
                    response.send({result: "ok", world_name: filename});
                }
                fs.rm("./uploads/"+filedata.filename, () => {})
            })
        })
    }
})
app.post("/getbackgrounds", jsonParser, function(request, response){
    var images = getImages("public/backgrounds");
    response.send(JSON.stringify(images));
});
app.post("/iscolab", jsonParser, function(request, response){
    let url;
    if(process.env.colaburl !== undefined){
        url = String(process.env.colaburl).trim();
    }
    let type = undefined;
    if(process.env.colab == 2){
        type = 'kobold_model';
    }
    if(process.env.colab == 3){
        type = 'kobold_horde';
    }
    if(process.env.colab == 4){
        type = 'openai';
    }
    if(process.env.colab == 5){
        type = 'free_launch';
    }
    response.send({colaburl: url, colab_type: type});
});
app.post("/getuseravatars", jsonParser, function(request, response){
    var images = getImages(UserAvatarsPath);
    response.send(JSON.stringify(images));
});
app.post("/adduseravatar", urlencodedParser, function(request, response){
    try {
        response_dw_bg = response;
        if(!request.body) return response.sendStatus(400);
        let filedata = request.file; 
        let fileType = ".png";
        let img_file;
        let img_path = "uploads/";
        img_file = filedata.filename; 
        sharp(img_path+img_file)
            .resize(400, 600)
            .toFormat('png')
            .toFile(`${UserAvatarsPath}${img_file}${fileType}`, (err) => {
                if(err) {
                    console.log(err);
                    return response.status(400).send(err); 
                }else{
                    console.log(img_file+fileType);
                    return response.status(200).send(img_file+fileType);
                }
            });
    }catch(err){
        console.log(err);
        return response.status(400).send(err);
    }
});
app.post("/deleteuseravatar", jsonParser, function (request, response) {
    try {
        let filename = request.body.filename;
        let filePath = `${UserAvatarsPath}${filename}`;
        fs.unlinkSync(filePath);
        return response.status(200).json({});
    } catch (err) {
        console.log(err);
        return response.status(400).json({error: err.toString()});
    }
});
app.post("/setbackground", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
    //const data = request.body;
    //console.log(request);
    //console.log(1);
    let bg;
    if(request.body.bg == 'none'){
        bg = "#bg1 {display: none;}";
    }else{
        bg = "#bg1 {background-image: "+request.body.bg+";}";
    }
    fs.writeFile('public/css/bg_load.css', bg, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
        }else{
            //response.redirect("/");
            response.send({result:'ok'});
        }
    });
});
app.post("/delbackground", jsonParser, function(request, response){
    if(!request.body) return response.sendStatus(400);
    rimraf('public/backgrounds/'+request.body.bg.replace(/\.\.[\/\\]/g, ""), (err) => {
        if(err) {
            response.send(err);
            return console.log(err);
        }else{
            //response.redirect("/");
            response.send('ok');
        }
    });
});
app.post("/downloadbackground", urlencodedParser, function(request, response){
    response_dw_bg = response;
    if(!request.body) return response.sendStatus(400);
    let filedata = request.file;
    console.log(filedata.mimetype);
    var fileType = ".png";
    var img_file = "ai";
    var img_path = "public/img/";
    img_path = "uploads/";
    img_file = filedata.filename;
    if (filedata.mimetype == "image/jpeg") fileType = ".jpeg";
    if (filedata.mimetype == "image/png") fileType = ".png";
    if (filedata.mimetype == "image/gif") fileType = ".gif";
    if (filedata.mimetype == "image/bmp") fileType = ".bmp";
    if (filedata.mimetype == "image/webp") fileType = ".webp";
    fs.copyFile(img_path+img_file, 'public/backgrounds/'+img_file+fileType, (err) => {
        if(err) {
            return console.log(err);
        }else{
            //console.log(img_file+fileType);
            response_dw_bg.send(img_file+fileType);
        }
        //console.log('The image was copied from temp directory.');
    });
});
app.post("/savesettings", jsonParser, function(request, response){
    if(BETA_KEY !== undefined){
        request.body.BETA_KEY = BETA_KEY;
    }
    fs.writeFile('public/settings.json', JSON.stringify(request.body), 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
            //response.send(err);
        }else{
            //response.redirect("/");
            response.send({result: "ok"});
        }
    });
});
function updateSettings(newSettings) {
    // Read the settings file
    const settingsData = fs.readFileSync('public/settings.json', 'utf8');
    const settings = JSON.parse(settingsData);
    // Update the settings object with new data
    Object.assign(settings, newSettings);
    // Write the updated settings object back to the file
    fs.writeFileSync('public/settings.json', JSON.stringify(settings, null, 2));
}
app.post('/getsettings', jsonParser, (request, response) => { //Wintermute's code
    const koboldai_settings = [];
    const koboldai_setting_names = [];
    const novelai_settings = [];
    const novelai_setting_names = [];
    const webui_settings = [];
    const webui_setting_names = [];
    let settings = fs.readFileSync('public/settings.json', 'utf8',  (err, data) => {
    if (err) return response.sendStatus(500);
        return data;
    });
    let settings_data = JSON.parse(settings);
    if(settings_data.BETA_KEY !== undefined && settings_data.BETA_KEY !== ""){
        BETA_KEY = settings_data.BETA_KEY;
        delete settings_data.BETA_KEY;
    }else{
        BETA_KEY = undefined;
    }
    settings = JSON.stringify(settings_data);
    //Kobold
    const files = fs
    .readdirSync('public/KoboldAI Settings')
    .sort(
      (a, b) =>
        new Date(fs.statSync(`public/KoboldAI Settings/${b}`).mtime) -
        new Date(fs.statSync(`public/KoboldAI Settings/${a}`).mtime)
    );
    files.forEach(item => {
        const file = fs.readFileSync(
        `public/KoboldAI Settings/${item}`,
        'utf8',
            (err, data) => {
                if (err) return response.sendStatus(500)
                return data;
            }
        );
        koboldai_settings.push(file);
        koboldai_setting_names.push(item.replace(/\.[^/.]+$/, ''));
    });
    //Novel
    const files2 = fs
    .readdirSync('public/NovelAI Settings')
    .sort(
      (a, b) =>
        new Date(fs.statSync(`public/NovelAI Settings/${b}`).mtime) -
        new Date(fs.statSync(`public/NovelAI Settings/${a}`).mtime)
    );
    files2.forEach(item => {
    const file2 = fs.readFileSync(
        `public/NovelAI Settings/${item}`,
        'utf8',
        (err, data) => {
            if (err) return response.sendStatus(500);
            return data;
        }
    );
        novelai_settings.push(file2);
        novelai_setting_names.push(item.replace(/\.[^/.]+$/, ''));
    });
    //WEBUI
    const files3 = fs
    .readdirSync('public/WebUI Settings')
    .sort(
      (a, b) =>
        new Date(fs.statSync(`public/WebUI Settings/${b}`).mtime) -
        new Date(fs.statSync(`public/WebUI Settings/${a}`).mtime)
    );
    files3.forEach(item => {
    const file3 = fs.readFileSync(
        `public/WebUI Settings/${item}`,
        'utf8',
        (err, data) => {
            if (err) return response.sendStatus(500);
            return data;
        }
    );
        webui_settings.push(file3);
        webui_setting_names.push(item.replace(/\.[^/.]+$/, ''));
    });
    //Styles
    const templates = fs.readdirSync('public/templates')
        .filter(file => file.endsWith('.css'))
        .sort();
    response.send({
        charaCloudMode: charaCloudMode,
        charaCloudServer: charaCloudServer,
        characterFormat: characterFormat,
        settings,
        templates,
        koboldai_settings,
        koboldai_setting_names,
        novelai_settings,
        novelai_setting_names,
        webui_settings,
        webui_setting_names
    });
});
app.post("/savefolders", jsonParser, function(request, response){
    fs.writeFile(`${charactersPath}folders.json`, JSON.stringify(request.body, null, 2), 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
        }else{
            response.send({result: "ok"});
        }
    });
});
app.post('/loadfolders', jsonParser, (request, response) => {
    fs.readFile(`${charactersPath}folders.json`, 'utf8',  (err, data) => {
        if (err) return response.sendStatus(500);
        return response.send(data);
    });
});
app.post("/savestyle", jsonParser, function(request, response){
    const this_style = request.body.style;
    let file_data = '@import "../templates/classic.css";';
    if(this_style != 'classic.css'){
        file_data = '@import "../templates/classic.css";@import "../templates/'+this_style+'";';
    }
    fs.writeFile('public/css/templates.css', file_data, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
            //response.send(err);
        }else{
            //response.redirect("/");
            response.send({result: "ok"});
        }
    });
});
function getCharaterFile(directories,response,i){ //old need del
    if(directories.length > i){
        
        fs.stat(charactersPath+directories[i]+'/'+directories[i]+".json", function(err, stat) {
            if (err == null) {
                fs.readFile(charactersPath+directories[i]+'/'+directories[i]+".json", 'utf8', (err, data) => {
                    if (err) {
                      console.error(err);
                      return;
                    }
                    //console.log(data);
                    characters[character_i] = {};
                    characters[character_i] = data;
                    i++;
                    character_i++;
                    getCharaterFile(directories,response,i);
                });
            }else{
                i++;
                getCharaterFile(directories,response,i);
            }
        });
    }else{
        response.send(JSON.stringify(characters));
    }
}
function getImages(path) {
    return fs.readdirSync(path).sort(function (a, b) {
return new Date(fs.statSync(path + '/' + a).mtime) - new Date(fs.statSync(path + '/' + b).mtime);
}).reverse();
}
function getKoboldSettingFiles(path) {
    return fs.readdirSync(path).sort(function (a, b) {
return new Date(fs.statSync(path + '/' + a).mtime) - new Date(fs.statSync(path + '/' + b).mtime);
}).reverse();
}
function getDirectories(path) {
  return fs.readdirSync(path).sort(function (a, b) {
return new Date(fs.statSync(path + '/' + a).mtime) - new Date(fs.statSync(path + '/' + b).mtime);
}).reverse();
}
//***********Novel.ai API 
app.post("/getstatus_novelai", jsonParser, function(request, response_getstatus_novel =response){
    
    if(!request.body) return response_getstatus_novel.sendStatus(400);
    api_key_novel = request.body.key;
    var data = {};
    var args = {
        data: data,
        
        headers: { "Content-Type": "application/json",  "Authorization": "Bearer "+api_key_novel}
    };
    client.get(api_novelai+"/user/subscription",args, function (data, response) {
        if(response.statusCode == 200){
            //console.log(data);
            response_getstatus_novel.send(data);//data);
        }
        if(response.statusCode == 401){
            console.log('Access Token is incorrect.');
            response_getstatus_novel.send({error: true, error_message: "Access token is incorrect."});
        }
        if(response.statusCode == 500 || response.statusCode == 501 || response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            response_getstatus_novel.send({error: true, error_message: "Error. Status code: " + response.statusCode});
        }
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_getstatus_novel.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.post("/generate_novelai", jsonParser, function(request, response_generate_novel = response){
    if(!request.body) return response_generate_novel.sendStatus(400);
    console.log(request.body);
    var data = {
    "input": request.body.input,
    "model": request.body.model,
    "parameters": {
        "use_string": request.body.use_string,
        "temperature": request.body.temperature,
        "max_length": request.body.max_length,
        "min_length": request.body.min_length,
        "top_a": request.body.top_a,
        "top_k": request.body.top_k,
        "top_p": request.body.top_p,
        "typical_p": request.body.typical_p,
        "tail_free_sampling": request.body.tail_free_sampling,
        "repetition_penalty": request.body.repetition_penalty,
        "repetition_penalty_range": request.body.repetition_penalty_range,
        "repetition_penalty_slope": request.body.repetition_penalty_slope,
        "repetition_penalty_frequency": request.body.repetition_penalty_frequency,
        "repetition_penalty_presence": request.body.repetition_penalty_presence,
        //"stop_sequences": {{187}},
        //bad_words_ids = {{50256}, {0}, {1}};
        //generate_until_sentence = true;
        "use_cache": request.body.use_cache,
        //use_string = true;
        "return_full_text": request.body.return_full_text,
        "prefix": request.body.prefix,
        "order": request.body.order
        }
    };
    var args = {
        data: data,
        headers: { "Content-Type": "application/json",  "Authorization": "Bearer "+api_key_novel},
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_novelai+"/ai/generate",args, function (data, response) {
        if(response.statusCode == 201){
            console.log(data);
            response_generate_novel.send(data);
        }
        if(response.statusCode == 400){
            console.log('Validation error');
            response_generate_novel.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 401){
            console.log('Access Token is incorrect');
            response_generate_novel.send({error: true, error_message: "Access token is incorrect."});
        }
        if(response.statusCode == 402){
            console.log('An active subscription is required to access this endpoint');
            response_generate_novel.send({error: true, error_message: "An active subscription is required to access this endpoint"});
        }
        if(response.statusCode == 500 || response.statusCode == 409){
            console.log(data);
            response_generate_novel.send({error: true, error_message: "Error. Status code: " + response.statusCode});
        }
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_generate_novel.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
//***********Horde API
app.post("/generate_horde", jsonParser, function(request, response_generate_horde){
    hordeActive = true;
    hordeData = null;
    hordeError = null;
    hordeQueue = 0;
    // Throw validation error if nothing sent/fails?
    if(!request.body) return response_generate_horde.sendStatus(400);
    //console.log(request.body.prompt); // debug
    // Prompt variable
    let request_prompt = request.body.prompt;
    var this_settings = {
        "prompt": request_prompt,
        "params": {
            "n": request.body.n,
            "frmtadsnsp": request.body.frmtadsnsp,
            "frmtrmblln": request.body.frmtrmblln,
            "frmtrmspch": request.body.frmtrmspch,
            "frmttriminc": request.body.frmttriminc,
            "max_context_length": request.body.max_context_length,
            "max_length": request.body.max_length,
            "rep_pen": request.body.rep_pen,
            "rep_pen_range": request.body.rep_pen_range,
            "rep_pen_slope": request.body.rep_pen_slope,
            "singleline": request.body.singleline,
            "temperature": request.body.temperature,
            "tfs": request.body.tfs,
            "top_a": request.body.top_a,
            "top_k": request.body.top_k,
            "top_p": request.body.top_p,
            "typical": request.body.typical,
            "sampler_order":  [request.body.s1,request.body.s2,request.body.s3,request.body.s4,request.body.s5,request.body.s6,request.body.s7]
        },
        "models": request.body.models
    };
    var args = {
        data: this_settings,
        headers: {"Content-Type": "application/json", "apikey": request.body.horde_api_key},
        requestConfig: {
            timeout: 10 * 600 * 1000
        }
    };
    console.log(this_settings);
    client.post(api_horde+"/v2/generate/text/async", args, function (data, response) {
        if(response.statusCode == 202){
            console.log(data);
            pollHordeStatus(data.id, args).then(resolve => {
                response_generate_horde.send({ started: true });
            }, reject => {
                response_generate_horde.send({error: true, message: reject});
            });
        }
        if(response.statusCode == 401){
            console.log('Validation error');
            response_generate_horde.send({error: true, error_message: "Validation error."});
        }
        if(response.statusCode == 429 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_generate.send({error: true, error_message: data.detail.msg});
            } else {
                response_generate.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        hordeActive = false;
        console.log(err);
        //console.log('something went wrong on the request', err.request.options);
        response_generate_horde.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
function pollHordeStatus(id, args, callback) {
    return new Promise((resolve, reject) => {
        client.get(api_horde + "/v2/generate/text/status/" + id, args, function (gen, response) {
            hordeData = gen;
            hordeWaitProgress(gen);
            if ((gen.done || gen.finished) && gen.generations != undefined) {
                hordeActive = false;
                hordeQueue = 0;
                hordeError = null;
                console.log({Kudos: gen.kudos});
                console.log(gen.generations);
                resolve();
                return;
            } else if(gen.faulted || (!gen.processing && !gen.waiting && !gen.is_possible)) {
                hordeActive = false;
                hordeQueue = 0;
                hordeError = gen.message;
                console.log(hordeData);
                console.error("Horde error", gen.message);
                reject(gen.message);
                return;
            }
            setTimeout(() => pollHordeStatus(id, args), 3000);
            resolve();
        }).on('error', function (err) {
            hordeActive = false;
            hordeData = null;
            hordeError = err;
            console.log(err);
            reject(err);
        });
    });
}
function hordeWaitProgress(data){
    if(data.queue_position !== undefined){
        hordeQueue = data.queue_position
    }
    try {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        hordeTicker = hordeTicker > 2 ? 0 : hordeTicker+1;
        let ticker = ["/", "-", "\\", "|" ][hordeTicker];
        if (data.queue_position > 0) {
            process.stdout.write(ticker + " Queue position: " + data.queue_position);
        } else if (data.wait_time > 0) {
            process.stdout.write(ticker + " Wait time: " + data.wait_time);
        }
    } catch (error) {
        return;
    }
}
app.post("/getstatus_horde", jsonParser, function(request, response_getstatus_horde){
    if(!request.body) return response_getstatus_horde.sendStatus(400);
    horde_api_key = request.body.horde_api_key;
    var args = { "type": "text" };
    client.get(api_horde+"/v2/status/models?type=text",args, function (data, response) {
        if(response.statusCode == 200){
            console.log({ Models: 'List fetched and updated.' });
            response_getstatus_horde.send(data);//data);
        } else {
            console.log(data);
            response_getstatus_horde.send({error: true, error_message: "Could not fetch model list."});
        }
    }).on('error', function (err) {
        response_getstatus_horde.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.get("/gethordeinfo", jsonParser, function(request, response){
    response.send({
        running: hordeActive,
        queue: hordeQueue,
        hordeData: hordeData,
        error: hordeError,
    });
});
//***********OpenAI API
app.post("/getstatus_openai", jsonParser, function(request, response_getstatus_openai){
    if(!request.body) return response_getstatus_openai.sendStatus(400);
    api_key_openai = request.body.key;
    api_url_openai = request.body.url;
    if(api_url_openai.indexOf('localhost') != -1){
        api_url_openai = api_url_openai.replace('localhost','127.0.0.1');
    }
    var args = {};
    if(api_key_openai && api_key_openai.length) {
        args = {
            headers: {"Authorization": "Bearer " + api_key_openai}
        };
    }
    client.get(api_url_openai+"/models", args, function (data, response) {
        if(response.statusCode == 200){
            response_getstatus_openai.send(data);
        }
        if(response.statusCode == 401){
            console.log('Invalid Authentication');
            response_getstatus_openai.send({error: true, error_message: "Invalid Authentication."});
        }
        if(response.statusCode == 429){
            console.log('Rate limit reached for requests');
            response_getstatus_openai.send({error: true, error_message: "Rate limit reached for requests."});
        }
        if(response.statusCode == 500){
            console.log('The server had an error while processing your request');
            response_getstatus_openai.send({error: true, error_message: "The server had an error while processing your request."});
        }
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_getstatus_openai.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.post("/generate_openai", jsonParser, function(request, response_generate_openai){
    if(!request.body) return response_generate_openai.sendStatus(400);
    console.log(request.body);
    var data = {
        "model": request.body.model,
        "max_tokens": request.body.max_tokens,
        "temperature": request.body.temperature,
        "top_p": request.body.top_p,
        "presence_penalty": request.body.presence_penalty,
        "frequency_penalty": request.body.frequency_penalty,
        "stop": request.body.stop
    };
    let request_path = '';
    if(isChatModel(request.body.model)){
        request_path = '/chat/completions';
        data.messages = request.body.messages;
    }else{
        request_path = '/completions';
        data.prompt = request.body.prompt;
    }
    let args = {};
    if(api_key_openai && api_key_openai.length){
        args = {
            data: data,
            headers: {"Content-Type": "application/json", "Authorization": "Bearer " + api_key_openai},
            requestConfig: {
                timeout: connectionTimeoutMS
            }
        };
    }else{
        args = {
            data: data,
            headers: {"Content-Type": "application/json"},
            requestConfig: {
                timeout: connectionTimeoutMS
            }
        };
    }
    client.post(api_url_openai+request_path,args, function (data, response) {
        try {
            if(isChatModel(request.body.model)){
                console.log(data);
                if(!data.choices || !data.choices[0]) {
                    let message = null;
                    let code = null;
                    if(data.error) {
                        message = data.error.message;
                        code = data.error.type;
                    }
                    response_generate_openai.send({ error: true, error_message: message, error_code: code });
                    return;
                }
                if(data.choices[0].message !== undefined){
                    console.log(data.choices[0].message);
                }
            }else{
                console.log(data);
            }
            console.log(response.statusCode);
            if(response.statusCode <= 299){
                return response_generate_openai.send(data);
            }
            if(response.statusCode == 401){
                console.log('Invalid Authentication');
                return response_generate_openai.send({error: true, error_code: 401, error_message: "Invalid Authentication"});
            }
            if(response.statusCode == 404){
                console.log('Model not found');
                return response_generate_openai.send({error: true, error_code: 404, error_message: "Model not found"});
            }
            if(response.statusCode == 429){
                console.log('Rate limit reached for requests');
                return response_generate_openai.send({error: true, error_code: 429, error_message: "Rate limit reached for requests"});
            }
            if(response.statusCode == 500){
                console.log('The server had an error while processing your request');
                return response_generate_openai.send({error: true, error_code: 500, error_message: "The server had an error while processing your request"});
            }
            console.log('Unique error');
            return response_generate_openai.send({error: true, error_code: response.statusCode, error_message: "Unique error"});
        }catch (error) {
            console.log("An error occurred: " + error);
            response_generate_openai.send({error: true, error_message: error});
        }
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_generate_openai.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});

app.post("/generate_ollama", jsonParser, function(request, response_generate_ollama_func = response){ // Assign to a different name to avoid conflict
    if(!request.body) return response_generate_ollama_func.sendStatus(400);
    console.log(request.body);

    let current_api_ollama = api_ollama; // Default to constant
    if (request.body.api_url && request.body.api_url.trim() !== '') {
        current_api_ollama = request.body.api_url.trim();
    }

    // model_ollama should be set by /getstatus_ollama or a settings panel in a real app
    // For now, ensure it's passed in the request or use a default.
    const current_model_ollama = request.body.model || model_ollama || "llama2"; // Fallback to llama2 if no model specified

    var data = {
        "model": current_model_ollama,
        "messages": request.body.messages,
        "stream": false, // Ollama supports streaming, but for simplicity, we'll use non-streaming for now
        // Add other parameters as supported by Ollama and needed by TavernAI
        // e.g., "max_tokens": request.body.max_tokens, "temperature": request.body.temperature etc.
        // Refer to Ollama documentation for available parameters: https://github.com/jmorganca/ollama/blob/main/docs/api.md
        "options": {
            "temperature": request.body.temperature,
            "top_p": request.body.top_p,
            "top_k": request.body.top_k,
            "num_predict": request.body.max_tokens // Ollama uses num_predict for max tokens
        }
    };

    var args = {
        data: data,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS // Use existing timeout setting
        }
    };

    client.post(current_api_ollama + "/api/chat", args, function (data, response) {
        try {
            console.log(data); // Log the raw response from Ollama
            if(response.statusCode == 200){
                // The response structure for non-streaming is a single JSON object per line.
                // We need to parse it if it's a string, or use directly if already an object.
                let ollamaResponse;
                if (typeof data === 'string') {
                    // Split by newline and parse the last valid JSON object
                    // This handles cases where multiple JSON objects might be sent in a single buffer
                    // or if there are any leading/trailing non-JSON characters (though less likely for non-streaming)
                    const lines = data.trim().split('\n');
                    ollamaResponse = JSON.parse(lines[lines.length - 1]);
                } else {
                    ollamaResponse = data;
                }
                // Adapt the response to the format expected by TavernAI frontend
                // This usually involves extracting the generated text and any other relevant info.
                // For Ollama, the generated text is in the "response" field.
                response_generate_ollama_func.send({ choices: [{ text: ollamaResponse.message.content }], usage: {completion_tokens: ollamaResponse.eval_count, prompt_tokens: ollamaResponse.prompt_eval_count} });
            } else {
                console.log("Ollama API Error - Status Code:", response.statusCode);
                console.log("Ollama API Error - Data:", data);
                let errorMessage = "Error generating text with Ollama.";
                if (data && data.error) {
                    errorMessage = data.error;
                } else if (typeof data === 'string') {
                    errorMessage = data;
                }
                response_generate_ollama_func.send({error: true, error_message: errorMessage, error_code: response.statusCode});
            }
        } catch (error) {
            console.log("Error processing Ollama response: " + error);
            console.log("Raw data from Ollama:", data); // Log raw data on error
            response_generate_ollama_func.send({error: true, error_message: "Error processing Ollama response: " + error.message});
        }
    }).on('error', function (err) {
        console.log("Ollama request error:", err);
        response_generate_ollama_func.send({error: true, error_message: "Unspecified error while sending the request to Ollama.\n" + err});
    });
});

//***********Ollama API
app.post("/getstatus_ollama", jsonParser, function(request, response_getstatus_ollama_func = response){ // Assign to a different name to avoid conflict
    if(!request.body) return response_getstatus_ollama_func.sendStatus(400);

    let current_api_ollama = api_ollama; // Default to constant
    if (request.body.api_url && request.body.api_url.trim() !== '') {
        current_api_ollama = request.body.api_url.trim();
    }

    client.get(current_api_ollama + "/api/tags", function (data, response) { // Ollama uses /api/tags to list models
        if(response.statusCode == 200){
            // Assuming data contains model information, similar to other /getstatus endpoints
            // Modify this part based on the actual response structure of Ollama's /api/tags
            response_getstatus_ollama_func.send(data);
        } else {
            response_getstatus_ollama_func.send({error: true, error_message: "Error connecting to Ollama. Status code: " + response.statusCode});
        }
    }).on('error', function (err) {
        response_getstatus_ollama_func.send({error: true, error_message: "Unspecified error while sending the request to Ollama.\n" + err});
    });
});

function isChatModel(model_openai){
    if (model_openai === 'text-davinci-003' || model_openai === 'text-davinci-002' || model_openai === 'text-curie-001' || model_openai === 'text-babbage-001' || model_openai === 'text-ada-001' || model_openai === 'code-davinci-002' || model_openai === 'gpt-3.5-turbo-instruct') {
        return false;
    } else {
        return true;
    }
}

//***********Claude API
app.post("/getstatus_claude", jsonParser, function(request, response_getstatus_claude){
    if(!request.body) return response_getstatus_claude.sendStatus(400);
    api_key_claude = request.body.key;

    var args = {};
    if(api_key_openai && api_key_openai.length) {
        args = {
            headers: {"Authorization": "Bearer " + api_key_openai}
        };
    }

    let data = {'connect':true};
    response_getstatus_claude.send(data);


});


app.post("/generate_claude", jsonParser, function(request, response_generate_claude){
    if(!request.body) return response_generate_claude.sendStatus(400);
    console.log(request.body);
    var data = {
        "model": request.body.model,
        "max_tokens": request.body.max_tokens,
        "temperature": request.body.temperature,
        "top_p": request.body.top_p,
        "top_k": request.body.top_k
    };

    data.messages = request.body.messages;

    let args = {};

        args = {
            data: data,
            headers: {"Content-Type": "application/json", "x-api-key": api_key_claude, "anthropic-version": "2023-06-01"},
            requestConfig: {
                timeout: connectionTimeoutMS
            }
        };

    client.post("https://api.anthropic.com/v1/messages",args, function (data, response) {
        try {
            console.log(data);
            if(!data.content || !data.content[0]) {
                let message = null;
                let code = null;
                if(data.error) {
                    message = data.error.message;
                    code = data.error.type;
                }
                response_generate_claude.send({ error: true, error_message: message, error_code: code });
                return;
            }
            if(data.content[0].text !== undefined){
                console.log(data.content[0].text);
            }

            console.log(response.statusCode);
            if(response.statusCode <= 299){
                return response_generate_claude.send(data);
            }
            if(response.statusCode == 400){
                console.log('Issue with the format or content');
                return response_generate_claude.send({error: true, error_code: 400, error_message: "There was an issue with the format or content of your request"});
            }
            if(response.statusCode == 401){
                console.log('Invalid Authentication');
                return response_generate_claude.send({error: true, error_code: 401, error_message: "Invalid Authentication"});
            }
            if(response.statusCode == 403){
                console.log('Permission error');
                return response_generate_claude.send({error: true, error_code: 403, error_message: "Your API key does not have permission to use the specified resource."});
            }
            if(response.statusCode == 404){
                console.log('Resource  not found');
                return response_generate_claude.send({error: true, error_code: 404, error_message: "Resource not found"});
            }
            if(response.statusCode == 429){
                console.log('Rate limit reached for requests');
                return response_generate_claude.send({error: true, error_code: 429, error_message: "Rate limit reached for requests"});
            }
            if(response.statusCode == 500){
                console.log('The server had an error while processing your request');
                return response_generate_claude.send({error: true, error_code: 500, error_message: "The server had an error while processing your request"});
            }
            if(response.statusCode == 529 ){
                console.log('Anthropic API is temporarily overloaded.');
                return response_generate_claude.send({error: true, error_code: 529 , error_message: "Anthropic's API is temporarily overloaded."});
            }
            console.log('Unique error');
            return response_generate_claude.send({error: true, error_code: response.statusCode, error_message: "Unique error"});
        }catch (error) {
            console.log("An error occurred: " + error);
            response_generate_claude.send({error: true, error_message: error});
        }
    }).on('error', function (err) {
        //console.log('');
    //console.log('something went wrong on the request', err.request.options);
        response_generate_openai.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});

//////////
app.post("/getallchatsofchatacter", jsonParser, function(request, response){
    if(!request.body) return response.sendStatus(400);
    var char_dir = (request.body.filename).replace(`.${characterFormat}`,'');
    fs.readdir(chatsPath+char_dir, (err, files) => {
        if (err) {
          console.error(err);
          response.send({error: true});
          return;
        }
        // filter for JSON files
        const jsonFiles = files.filter(file => path.extname(file) === '.jsonl');
        // sort the files by name
        //jsonFiles.sort().reverse();
        // print the sorted file names
        var chatData = {};
        let ii = jsonFiles.length;
        for(let i = jsonFiles.length-1; i >= 0; i--){
            const file = jsonFiles[i];
            const fileStream = fs.createReadStream(chatsPath+char_dir+'/'+file);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });
            let firstLine; 
            let lastLine;
            rl.on('line', (line) => {
                if (!firstLine) {
                    firstLine = line;
                }
                lastLine = line;
            });
            rl.on('close', () => {
                if(lastLine){
                    let firstLineData;
                    let chat_name;
                    if(firstLine){
                        firstLineData = json5.parse(firstLine);
                        if(firstLineData['chat_name']){
                            chat_name = firstLineData['chat_name'];
                        }
                    }
                    let lastLineData = json5.parse(lastLine);
                    if(lastLineData.name !== undefined){
                        chatData[i] = {};
                        chatData[i]['file_name'] = file;
                        if(chat_name) chatData[i]['chat_name'] = chat_name;
                        chatData[i]['mes'] = lastLineData['mes'];
                        chatData[i]['mes_send_date'] = lastLineData['send_date'];
                        ii--;
                        if(ii === 0){ 
                            response.send(chatData);
                        }
                    }else{
                        return;
                    }
                  }
                rl.close();
            });
        }
    });
});
function setCardName(character_name){
    let target_img = sanitize_filename(character_name);
    if(target_img.length === 0){
        return target_img = uuid.v4().replace(/-/g, '');
    }
    let i = 1;
    let base_name = target_img;
    while (fs.existsSync(charactersPath+target_img+`.${characterFormat}`)) {
        target_img = base_name+i;
        i++;
    }
    return target_img;
}
app.post("/importcharacter", urlencodedParser, async function(request, response){
    if(!request.body) return response.sendStatus(400);
        let img_name = '';
        let filedata = request.file;
        var format = request.body.file_type;
        if(filedata){
            if(format == 'json'){
                fs.readFile('./uploads/'+filedata.filename, 'utf8', async (err, data) => {
                    if (err){
                        response.send({error:true});
                    }
                    const jsonData = json5.parse(data);
                    if(jsonData.name !== undefined){
                        img_name = setCardName(jsonData.name);
                        let pre_data = {"name": jsonData.name, "description": jsonData.description, "personality": jsonData.personality, "first_mes": jsonData.first_mes, "avatar": 'none', "chat": Date.now(), "mes_example": jsonData.mes_example, "scenario": jsonData.scenario};
                        let char = charaFormatData(pre_data);
                        char = JSON.stringify(char);
                        await charaWrite('./public/img/fluffy.png', char, charactersPath + img_name, characterFormat);
                        response.status(200).send({file_name: img_name});
                    }else if(jsonData.char_name !== undefined){
                        img_name = setCardName(jsonData.char_name);
                        let pre_data = {"name": jsonData.char_name, "description": jsonData.char_persona, "personality": '', "first_mes": jsonData.char_greeting, "avatar": 'none', "chat": Date.now(), "mes_example": jsonData.example_dialogue, "scenario": jsonData.world_scenario};
                        let char = charaFormatData(pre_data);
                        char = JSON.stringify(char);
                        await charaWrite('./public/img/fluffy.png', char, charactersPath + img_name, characterFormat);
                        response.status(200).send({file_name: img_name});
                    }else{
                        console.log('Incorrect character format .json');
                        response.send({error:true});
                    }
                });
            }else{
                try{
                    var img_data = await charaRead('./uploads/'+filedata.filename, format);
                    let jsonData = json5.parse(img_data);
                    if(jsonData.spec === "chara_card_v2") jsonData = parseV2CharacterCard(jsonData);
                    img_name = setCardName(jsonData.name);
                    if(checkCharaProp(img_name).length > 0){
                        let char = charaFormatData(jsonData);
                        char.add_date_local = Date.now();
                        char.last_action_date = Date.now();
                        char = JSON.stringify(char);
                        await charaWrite('./uploads/'+filedata.filename, char, charactersPath + img_name, characterFormat, response, {file_name: img_name});
                        response.status(200).send({file_name: img_name});
                    }else{
                        console.log('Incorrect character card');
                        response.send({error:true});
                    }
                }catch(err){
                    console.log(err);
                    response.send({error:true});
                }
            }
        }
});
function parseV2CharacterCard(jsonData){
    return {
        name: jsonData.data.name, 
        description: jsonData.data.description, 
        personality: jsonData.data.personality,
        first_mes: jsonData.data.first_mes,
        mes_example: jsonData.data.mes_example,
        scenario: jsonData.data.scenario
    };
}
app.post("/importchat", urlencodedParser, function(request, response){
    if(!request.body) return response.sendStatus(400);
        var format = request.body.file_type;
        let filedata = request.file;
        let avatar_url = (request.body.filename).replace(`.${characterFormat}`, '');
        let ch_name = request.body.character_name;
        //console.log(filedata.filename);
        //var format = request.body.file_type;
        //console.log(format);
        //console.log(1);
        if(filedata){
            //
            //The "Raw format;" assumes the following:
            //You: Hello! *Waves*
            //Them: *Smiles* Hello!
            //
            if(format === 'txt'){
                const fileStream = fs.createReadStream('./uploads/'+filedata.filename, "utf8");
                const rl = readline.createInterface({
                    input: fileStream,
                    crlfDelay: Infinity
                });
                let created = Date.now();
                var new_chat = [];
                new_chat.push({
                    user_name: "You",
                    character_name: ch_name,
                    create_date: created
                });
                rl.on("line", line => {
                    if(line && line.length) {
                        let is_user = !!line.match(/^You:/);
                        const text = line
                            .replace(/^[^:]*: ?/, "")
                            .trim()
                        ;
                        if(text) {
                            new_chat.push({
                                name: is_user ? "You" : ch_name,
                                is_user: is_user,
                                is_name: true,
                                send_date: ++created,
                                mes: text
                            });
                        }
                    }
                });
                rl.on("close", () => {
                    const chatJsonlData = new_chat.map(JSON.stringify).join('\n');
                    fs.writeFile(chatsPath+avatar_url+'/'+Date.now()+'.jsonl', chatJsonlData, 'utf8', function(err) {
                        if(err) {
                            response.send(err);
                            return console.log(err);
                        }else{
                            response.send({res:true});
                        }
                    });
                });
            } else if(format === 'json'){
                fs.readFile('./uploads/'+filedata.filename, 'utf8', (err, data) => {
                    if (err){
                        console.log(err);
                        response.send({error:true});
                    }
                    const jsonData = json5.parse(data);
                    var new_chat = [];
                    //
                    // Collab format: array of alternating exchanges, e.g.
                    //  { chat: [
                    //      "You: Hello there.",
                    //      "Them: \"Oh my! Hello!\" *They wave.*"
                    //  ] }
                    //
                    if(jsonData.chat && Array.isArray(jsonData.chat)){
                        let created = Date.now();
                        new_chat.push({
                            user_name: "Someone",
                            character_name: ch_name,
                            create_date: created
                        });
                        jsonData.chat.forEach(snippet => {
                            let is_user = !!snippet.match(/^You:/);
                            // replace all quotes around text, but not inside it
                            const text = snippet
                                .replace(/^[^:]*: ?/, "")
                                .trim()
                                .replace(/ +/g, ' ')
                                .replace(/" *$/g, '')
                                .replace(/" *\n/g, '\n')
                                .replace(/\n"/g, '\n')
                                .replace(/^"/g, '')
                                .replace(/" ?\*/g, ' *')
                                .replace(/\* ?"/g, '* ')
                            new_chat.push({
                                name: is_user ? "You" : ch_name,
                                is_user: is_user,
                                is_name: true,
                                send_date: ++created,
                                mes: text
                            });
                        });
                        const chatJsonlData = new_chat.map(JSON.stringify).join('\n');
                        fs.writeFile(chatsPath+avatar_url+'/'+Date.now()+'.jsonl', chatJsonlData, 'utf8', function(err) {
                            if(err) {
                                response.send(err);
                                return console.log(err);
                            }else{
                                response.send({res:true});
                            }
                        });
                    } else if(jsonData.histories !== undefined){
                        const chat = {
                            from(history) {
                                return [
                                    {
                                        user_name: 'You',
                                        character_name: ch_name,
                                        create_date: Date.now()
                                    },
                                    ...history.msgs.map(
                                        (message) => ({
                                            name: message.src.is_human ? 'You' : ch_name,
                                            is_user: message.src.is_human,
                                            is_name: true,
                                            send_date: Date.now(),
                                            mes: message.text
                                        })
                                    )];
                            }
                        }
                        const chats = [];
                        (jsonData.histories.histories ? jsonData.histories.histories : []).forEach((history) => {
                            chats.push(chat.from(history));
                        });
                        const errors = [];
                        let chat_name_i = 1;
                        chats.forEach(chat => fs.writeFile(
                            `${chatsPath}${avatar_url}/${Date.now()+(chat_name_i++)}.jsonl`,
                            chat.map(JSON.stringify).join('\n'), 'utf8',
                            (err) =>{
                                if(err) {
                                    errors.push(err);
                                }
                            })
                        );
                        if (0 < errors.length) {
                            return response.send('One or more errors occurred while writing character files. Errors: ' + JSON.stringify(errors));
                        }
                        return response.send({res:true});
                    }else{
                        response.send({error:true});
                    }
                });
            } else if(format === 'jsonl'){
                const fileStream = fs.createReadStream('./uploads/'+filedata.filename);
                const rl = readline.createInterface({
                  input: fileStream,
                  crlfDelay: Infinity
                });
                rl.once('line', (line) => {
                    let jsonData = json5.parse(line);
                    if(jsonData.user_name !== undefined){
                        fs.copyFile('./uploads/'+filedata.filename, chatsPath+avatar_url+'/'+Date.now()+'.jsonl', (err) => {
                            if(err) {
                                response.send({error:true});
                                return console.log(err);
                            }else{
                                response.send({res:true});
                                return;
                            }
                        });
                    }else{
                        //response.send({error:true});
                        return;
                    }
                    rl.close();
                });
            }
        }
});
app.post("/deletechat", jsonParser, function(request, response){
    try {
        if (!request.body)
            return response.sendStatus(400);
        let {chat_file, character_filename} = request.body;
        fs.unlinkSync(`${chatsPath}${character_filename}/${chat_file}`);
        return response.status(200).send({res:true});
    } catch (err) {
        console.error(err);
        return response.sendStatus(400).send({error: err});
    }
});
//System Prompt
app.post("/systemprompt_save", jsonParser, function(request, response){
    try {
        if (!request.body)
            return response.sendStatus(400);
        let {preset_name} = request.body;
        // Save the system_prompt to a JSON file
        const filePath = `public/System Prompts/${preset_name}.json`;
        const data = JSON.stringify(request.body);
        fs.writeFileSync(filePath, data);
        return response.status(200).send({res: true});
    } catch (err) {
        console.error(err);
        return response.status(400).send({error: err});
    }
});
app.post("/systemprompt_get", jsonParser, function(request, response){
    try {
        /*
        const filePath = 'public/System Prompts/system_prompt.json';
        const data = fs.readFileSync(filePath, 'utf8');
        //const system_prompt = JSON.parse(data);
        return response.status(200).send(data);
        */
        const folderPath = 'public/System Prompts';
        const files = fs.readdirSync(folderPath);
        const data = {};
        files.forEach(file => {
            const filePath = path.join(folderPath, file);
            const fileData = fs.readFileSync(filePath, 'utf8');
            const key = path.parse(file).name;
            const json = JSON.parse(fileData);
            data[key] = json;
        });
        return response.status(200).send(data);
    } catch (err) {
        console.error(err);
        return response.status(400).send({error: err});
    }
});
app.post("/systemprompt_new", jsonParser, function(request, response){
    try {
        if (!request.body)
            return response.sendStatus(400);
        let {preset_name} = request.body;
        preset_name = sanitize_filename(preset_name);
        if (preset_name.length === 0) {
            return response.status(400).send({error: "Wrong filename"});
        }
        const filePath = `public/System Prompts/${preset_name}.json`;
        if (fs.existsSync(filePath)) {
            return response.status(400).send({error: "File already exists"});
        }
        const data = JSON.stringify(request.body);
        fs.writeFileSync(filePath, data);
        return response.status(200).send({preset_name: preset_name});
    } catch (err) {
        console.error(err);
        return response.status(400).send({error: err});
    }
});
app.post("/systemprompt_delete", jsonParser, function(request, response){
    try {
        if (!request.body || !request.body.preset_name)
            return response.sendStatus(400);
        let {preset_name} = request.body;
        const filePath = `public/System Prompts/${preset_name}.json`;
        if(fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        } else {
            return response.status(400).send({error: `File ${filePath} not found`});
        }
        return response.status(200).send({res: true});
    } catch (err) {
        console.error(err);
        return response.status(400).send({error: err});
    }
});
// ======================================================================
// =======      ===        ==       ===  ====  ==        ==       =======
// ======  ====  ==  ========  ====  ==  ====  ==  ========  ====  ======
// ======  ====  ==  ========  ====  ==  ====  ==  ========  ====  ======
// =======  =======  ========  ===   ==  ====  ==  ========  ===   ======
// =========  =====      ====      ====   ==   ==      ====      ========
// ===========  ===  ========  ====  ===  ==  ===  ========  ====  ======
// ======  ====  ==  ========  ====  ===  ==  ===  ========  ====  ======
// ======  ====  ==  ========  ====  ====    ====  ========  ====  ======
// =======      ===        ==  ====  =====  =====        ==  ====  ======
// ======================================================================
// ======================================================================
// ==      =====    =========      ====       ===       ===        ==  ==
// =   ==   ===  ==  ========  ===  ===  ====  ==  ====  =====  =====  ==
// =  ====  ==  ====  =======  ====  ==  ====  ==  ====  =====  =====  ==
// =  ========  ====  =======  ===  ===  ===   ==  ===   =====  =====  ==
// =  ========  ====  =======      ====      ====      =======  =====  ==
// =  ===   ==  ====  =======  ===  ===  ====  ==  ====  =====  =====  ==
// =  ====  ==  ====  =======  ====  ==  ====  ==  ====  =====  =========
// =   ==   ===  ==  ========  ===  ===  ====  ==  ====  =====  =====  ==
// ==      =====    =========      ====  ====  ==  ====  =====  =====  ==
// ======================================================================
module.exports.express = express;
module.exports.path = path;
module.exports.fs = fs;
module.exports.jsonParser = jsonParser;
module.exports.charaCloudServer = charaCloudServer;
module.exports.client = client;
module.exports.json5 = json5;
module.exports.http = http;
module.exports.https = https;
module.exports.crypto = crypto;
module.exports.updateSettings = updateSettings;
module.exports.urlencodedParser = urlencodedParser;
module.exports.sharp = sharp;
module.exports.charaRead = charaRead;
module.exports.charaWrite = charaWrite;
module.exports.uuid = uuid;
module.exports.characterFormat = characterFormat;
module.exports.charaFormatData = charaFormatData;
module.exports.setCardName = setCardName;
module.exports.utf8Encode = utf8Encode;
module.exports.utf8Decode = utf8Decode;
module.exports.extract = extract;
module.exports.encode = encode;
module.exports.PNGtext = PNGtext;
module.exports.ExifReader = ExifReader;
module.exports.charactersPath = charactersPath;
const charaCloudRoute = require('./routes/characloud');
const e = require('express');
app.use('/api/characloud', charaCloudRoute);
//###########################  Server start  ########################
app.listen(server_port, listenIp, function() {
    if(process.env.colab !== undefined){
        if(process.env.colab == 2){
            is_colab = false;
        }
    }
    console.log('Launching...');
    initializationCards();
    clearUploads();
    initCardeditor();
    const autorunUrl = new URL(
            ('http://') +
            ('127.0.0.1') +
            (':' + server_port)
            );
    if(autorun) open(autorunUrl.toString());
    console.log('TavernAI has started and is available on IP: 127.0.0.1 at PORT: '+server_port);
    console.log('TavernAI is bound to interface: ' + listenIp);
    console.log('TavernAI url: ' + listenIp+ ':'+server_port);
});
function initializationCards() {
    const folderPath = charactersPath;
    // get all files in folder
    let this_format;
    let old_format;
    if (characterFormat === 'webp') {
        this_format = 'webp';
        old_format = 'png';
    } else {
        this_format = 'png';
        old_format = 'webp';
    }
    fs.readdir(folderPath, async (err, files) => {
        try {
            if (err) {
                console.error('Error reading folder:', err);
                return;
            }
            // add public_id
            for (const file of files) {
                try {
                    const filePath = path.join(folderPath, file);
                    // check if file is png image
                    if (!file.endsWith(`.${this_format}`)) {
                        continue;
                    }

                    // read metadata
                    const json_metadata = await charaRead(filePath);
                    let metadata = json5.parse(json_metadata);
                    // check if metadata contains chara.name
                    if (!metadata || !metadata.name) {
                        continue;
                    }
                    
                    if(metadata.public_id){ // Check if public_id already exist then pass to next card
                        if(metadata.public_id.length === 32){
                            continue;
                        }
                    }
                    

                    metadata = charaFormatData(metadata);
                    await charaWrite(filePath, JSON.stringify(metadata), charactersPath + file.replace(`.${this_format}`, ''), this_format);


                } catch (error) {
                    console.log('Init card error ' + file);
                    console.log(error);
                }
            }
            
            // Change format
            for (const file of files) {
                try {
                    const filePath = path.join(folderPath, file);
                    // check if file is png image
                    if (!file.endsWith(`.${old_format}`)) {
                        continue;
                    }

                    // read metadata
                    const json_metadata = await charaRead(filePath);
                    const metadata = json5.parse(json_metadata);
                    // check if metadata contains chara.name
                    if (!metadata || !metadata.name) {
                        continue;
                    }

                    // choose target filename
                    let targetName = setCardName(file.replace(`.${old_format}`, ''));
                    let targetPath = path.join(folderPath, targetName + `.${this_format}`);

                    // write image
                    await charaWrite(filePath, JSON.stringify(metadata), charactersPath + targetName, this_format);

                    // delete original file
                    if (fs.existsSync(targetPath)) { //make to check (need to meake charaWrite is )
                        // delete original file
                        fs.unlink(filePath, err => {
                            if (err) {
                                console.error('Error deleting file:', err);
                            } else {
                                console.log(targetName + ' has been converted to .' + this_format);
                                console.log('Deleted file:', filePath);
                            }
                        });
                    } else {
                        console.error('Error writing file:', targetPath);
                    }
                } catch (error) {
                    console.log('Convert card error ' + file);
                    console.log(error);
                }
            }
        } catch (error) {
            console.log(error);
        }
    });
}
function clearUploads() {
    let folderPath = './uploads';
    fs.readdir(folderPath, (err, files) => {
    if (err) {
        console.error('Error reading folder:', err);
        return;
    }

    for (const file of files) {
        const filePath = path.join(folderPath, file);

        fs.unlink(filePath, err => {
            if (err) {
                console.error('Error deleting file:', err);
            } else {
                console.log('Deleted file:', filePath);
            }
        });
    }
  });
}
function initCardeditor() {
    const folderPath = path.join(process.cwd(), 'public', 'cardeditor');
    if (fs.existsSync(folderPath)) {
        // Folder exists, delete files created more than 1 hour ago
        fs.readdirSync(folderPath).forEach((file) => {
            try {
                const filePath = path.join(folderPath, file);
                const stats = fs.statSync(filePath);
                const creationTime = stats.birthtime.getTime();
                const hourAgo = Date.now() - (1 * 60 * 60 * 1000);
                if (creationTime < hourAgo) {
                    fs.unlinkSync(filePath);
                }
            } catch (err) {
                console.log(err);
            }
        });
    } else {
        // Folder does not exist, create it
        fs.mkdirSync(folderPath);
    }
}
/*
//                                                                                       
//     'T`           *H*           +E+              +E+           (N(           =D=      
//    (o o)         (o o)         (o o)            (o o)         (o o)         (o o)     
//ooO--(_)--Ooo-ooO--(_)--Ooo-ooO--(_)--Ooo----ooO--(_)--Ooo-ooO--(_)--Ooo-ooO--(_)--Ooo-
//                                                                                       
//                                                                                       
//async function processImage(imagePath) {
  //for (let i = 0; i < 500; i++) {
    //const processedImagePath = imagePath;
    //try {
      //const imageBuffer = fs.readFileSync(imagePath);
      //let qwer = crypto.randomBytes(Math.floor(Math.random() * 2000)).toString('hex');
      //let aaa = `{"public_id":"undefined",${qwer}"}`;
      //const processedImage = await sharp(imageBuffer).resize(400, 600).webp({'quality':95}).withMetadata({
                        //exif: {
                            //IFD0: {
                                //UserComment: aaa
                            //}
                        //}
                    //}).toBuffer();
      //fs.writeFileSync(processedImagePath, processedImage);
      //console.log(`Iteration ${i}: Success`);
    //} catch (err) {
      //console.log(`Iteration ${i}: Error: ${err}`);
    //}
  //}
//}
//const imagePath = 'image.webp';
//processImage(imagePath);
*/
