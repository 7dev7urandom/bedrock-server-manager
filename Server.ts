import * as http from 'http';
import { Socket, Server as socketServer } from 'socket.io';
import * as socketio from 'socket.io';
import { readFile } from 'fs';
import { unescape } from 'querystring';
import { ServerPermissions } from './Constants';

export interface SocketListener {
    (socket: Socket, data: any): void;
}
export interface UserData {
    id: number;
    perm: string;
    socket?: Socket;
    username: string;
    globalPermissions: number;
    selectedServer: number | null;
}
export class GlobalPermissions extends ServerPermissions {
    static readonly CAN_CREATE_SERVER =     0b00000001;
    static readonly CAN_DELETE_SERVER =     0b00000010;
    static readonly CAN_GRANT_PERMISSIONS = 0b00000100;
    static readonly CAN_OVERRIDE_LOCAL =    0b00001000;
    static readonly CAN_REFRESH_DB =        0b00010000;

    // static readonly CAN_X =   0b00010000;
}
export class Server {
    static PORT = 3000;
    static page: string;
    static server: any;
    static io: socketServer;
    static listeners: Map<string, SocketListener[]> = new Map<string, SocketListener[]>();
    static dataFromId: Map<number, UserData> = new Map<number, UserData>();
    static idFromSocket: Map<Socket, number> = new Map<Socket, number>();

    static start(page) {
        Server.page = page;
        Server.server = http.createServer((req, res) => {
            let url = unescape(req.url);
            switch(url) {
                case '/':
                    url = '/index.html'
                default:
                    readFile(`${__dirname}/browser${unescape(url)}`, (err, data) => {
                        if(err) {
                            res.writeHead(404);
                            res.end(JSON.stringify(err));
                            return;
                        }
                        if(url.endsWith(".html"))
                            res.setHeader('Content-Type', 'text/html');
                        if(url.endsWith(".png"))
                            res.setHeader('Content-Type', 'image/png');
                        if(url.endsWith(".css"))
                            res.setHeader('Content-Type', 'text/css');
                        res.setHeader("Content-Length", Buffer.byteLength(data));
                        res.writeHead(200);
                        res.end(data);
                    });
            }
        });
        Server.io = socketio(Server.server);
        Server.io.on('connection', socket => {
            for (let event of Array.from(Server.listeners.keys())) {
                for(let callback of Server.listeners.get(event)) {
                    // console.log(`Event ${event} with callback ${callback}`);
                    socket.on(event, data => callback(socket, data));
                }
            }
        });
    }
    static listen() {
        
        Server.server.listen(Server.PORT, () => {
            console.log("Server started on port " + Server.PORT);
        });
    }

    static addListener(event: string, callback: SocketListener) {
        let currentListeners: SocketListener[] = Server.listeners.get(event);
        if(currentListeners == undefined) currentListeners = [];
        currentListeners.push(callback);
        Server.listeners.set(event, currentListeners);
    }
}