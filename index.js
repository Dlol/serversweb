const express = require("express")
const { exec, spawn } = require("child_process")
const { chdir } = require("process")
const fs = require("fs")
const YAML = require("yaml")
const { WebSocketServer } = require("ws");

const app = express()
const port = 3000

const scriptsPath = "/mnt/games/runners/"

function getFileDetails(path) {
    const file = fs.readFileSync(path, {encoding: "utf-8"});
    // console.log(file);
    const json = YAML.parse(file);
    return json;
}

/**
 * 
 * @param {String} session TMux session to send to
 * @param {String} command Keys/command to send to TMux
 */
function sendCommand(session, command) {
    console.log(`${session}: ${command}`);
    spawn("tmux", ["send-keys", "-t", session, command, "Enter"])
}

// Express Stuff
app.use(express.static('static'))

app.get('/listing', (req,res) => {
    const dir = fs.opendirSync(scriptsPath);
    console.log("got");
    let files = []
    let dirent = dir.readSync();
    while (dirent != null) {
        files.push(dirent.name.replace(/.yml$/, ""))
        dirent = dir.readSync();
    }
    console.log(files);
    res.send(files);
    dir.closeSync();
})

app.get('/run/:file', (req, res) => {
    const filepath = scriptsPath + req.params.file + ".yml"

    // exec(`servers -t -r ${filepath}`)
    const details = getFileDetails(filepath);
    process.chdir(details.dir);
    const tmux = spawn("tmux", ["new", "-d", "-s", details.tmux])
    tmux.on('exit', (code) => {
        for (const command of details.commands) {
            sendCommand(details.tmux, command);
        }

        res.send("running " + filepath)
    })
})

app.get("/stop/:file", (req, res) => {
    const filepath = scriptsPath + req.params.file + ".yml"
    const details = getFileDetails(filepath);
    for (const command of details.stop) {
        sendCommand(details.tmux, command);
    }
    sendCommand(details.tmux, "exit");
    if (sessions[details.tmux] != undefined) {
        clearInterval(sessions[details.tmux].interval)
        for (const client of sessions[details.tmux].clients) {
            openSockets[client].send("~~session ended~~")
        }
	delete sessions[details.tmux]
    }
    res.send("goodbye " + filepath)
})

app.get("/details/:file", (req, res) => {
    const fullpath = scriptsPath + req.params.file + ".yml";
    const file = fs.readFileSync(fullpath, {encoding: "utf-8"});
    console.log(file);
    const json = YAML.parse(file);
    console.log(json);
    res.send(json)
})

app.listen(port, () => {
    console.log(`Listening on ${port}`);
})
// End Express Stuff

// Websocket Stuff

const wss = new WebSocketServer({ port: 3001 });

let openSockets = {}
let sessions = {}

wss.on('connection', function connection(ws) {
    const id = String(Date.now());
    openSockets[id] = ws;
    console.log(`Connection with ID ${id}`);

    ws.on('error', console.error);

    ws.on('message', function message(data) {
        console.log('received: %s', data);
        const stuff = String(data).split(" ");
        const command = stuff.shift();
        switch (command) {
            case "tmux-connect":
                var sessionName = stuff[0];
                console.log("connecting to " + sessionName);
                if (sessions[sessionName] == undefined) {
                    sessions[sessionName] = {
                        "clients": [id]
                    }
                    const interval = setInterval(()=>{
                        // capture tmux screen
                        const process = spawn("tmux", ["capturep", "-p", "-t", sessionName])
                        process.stdout.on('data', (data) => {
                            // console.log(String(data));
                            for (const client of sessions[sessionName].clients) {
                                openSockets[client].send(String(data))
                            }
                        })
                        
                    }, 500);
                    sessions[sessionName].interval = interval;
                }
                else {
                    sessions[sessionName].clients.push(id);
                }
                break;
            
            case "tmux-send":
                var sessionName = stuff.shift();
                sendCommand(sessionName, stuff.join(" "))
                break;
            
            default:
                break;
        }
    });

    ws.on('close', () => {
        delete openSockets[id];
        console.log(`Goodbye ID:${id}`);
    })

  ws.send('Pong!');
});

function sendMessage(message) {
    for (const key in openSockets) {
        if (Object.hasOwnProperty.call(openSockets, key)) {
            const socket = openSockets[key];
            socket.send(message);
        }
    }
} 

wss.on('listening', () => {
    console.log("Websocket listening on 3001");
})

// End Websocket Stuff
