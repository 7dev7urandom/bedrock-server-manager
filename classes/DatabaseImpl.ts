import { createHash, randomBytes } from "crypto";
import { Server } from "../Server";
import { serverUpdate } from "../packetDef";
import { BServer, LocalPermissions } from "./BServer";
import DatabaseConnection from "./DatabaseConnection";
import Player from "./Player";
import { BDSXServer } from './BDSXServer';
import { VanillaServer } from './VanillaServer';
import { clobberUserList } from "./Listener";

const { servers } = BServer;

export default class Database {
    static async verifyTables() {
        await Promise.all([
            DatabaseConnection.query({
                text: DatabaseConnection.type === 'mysql' ?
                    'CREATE TABLE IF NOT EXISTS servers (id int NOT NULL AUTO_INCREMENT, path varchar(100), allowedusers JSON, description varchar(100), version varchar(15), autostart boolean, type varchar(15), PRIMARY KEY(id))'
                    : 'CREATE TABLE IF NOT EXISTS servers (id SERIAL PRIMARY KEY, path varchar(100), allowedusers JSON, description varchar(100), version varchar(15), autostart boolean, type varchar(15))'
            }),
            DatabaseConnection.query({
                text: 'CREATE TABLE IF NOT EXISTS players (username varchar(15), xuid varchar(20))'
            }),
            DatabaseConnection.query({
                text: DatabaseConnection.type === 'mysql' ?
                    'CREATE TABLE IF NOT EXISTS users (id int NOT NULL AUTO_INCREMENT, username varchar(20) NOT NULL, password char(32) NOT NULL, perm varchar(20), globalpermissions smallint, PRIMARY KEY(id))' :
                    'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username varchar(20) NOT NULL, password char(32) NOT NULL, perm varchar(20), globalpermissions smallint)'
            })
        ]);
        if ((await DatabaseConnection.query({
            text: 'SELECT * FROM users'
        })).rows.length === 0) {
            const password = this.generateRandomString(Math.floor(Math.random() * 3) + 8);
            const hash = createHash('md5').update(password).digest('hex');
            console.log(`No users found in database. Creating admin user 'admin' with password '${password}' and perm 'Superadmin'`);
            await DatabaseConnection.insertQueryReturnId({
                text: "INSERT INTO users (username, password, perm, globalpermissions) VALUES ('admin', $1, 'Superadmin', 255)",
                values: [hash]
            });
            // Server.dataFromId.set(id, {
            //     id,
            //     username: 'admin',
            //     perm: 'Superadmin',
            //     globalPermissions: 255,
            //     selectedServer: null,
            //     password: hash
            // });
        }
    }
    static async initializeDatabaseData(config): Promise<Map<number, BServer>> {
        await DatabaseConnection.connect(config);
        await this.verifyTables();
        // const servers: Map<number, BServer> = new Map();
        const proms = [];
        const serversArrProms = [];
        proms.push(DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM servers',
        }).then(result => {
            BServer.initTotalServers = result.rows.length;
            result.rows.forEach(server => {
                const allowedUsers = DatabaseConnection.type === 'mysql' ? JSON.parse(server.allowedusers) : server.allowedusers;
                switch (server.type) {
                case 'vanilla':
                    servers.set(server.id, new VanillaServer(server.id, server.description, server.autostart, server.path, server.version, allowedUsers));
                    break;
                case 'bdsx':
                    servers.set(server.id, new BDSXServer(server.id, server.description, server.autostart, server.path, server.version, allowedUsers));
                    break;
                }
                serversArrProms.push(servers.get(server.id).queryCreated());
            });
        }));
        proms.push(DatabaseConnection.query({
            text: 'SELECT * FROM players'
        }).then(result => {
            result.rows.forEach(p => new Player(p.username, p.xuid));
        }));
        proms.push(DatabaseConnection.query({
            text: "SELECT * FROM users",
        }).then(result => {
            result.rows.forEach(user => {
                // console.log(JSON.stringify(user));
                Server.dataFromId.set(user.id, {
                    // socket: socket,
                    username: user.username,
                    globalPermissions: user.globalpermissions,
                    selectedServer: null,
                    perm: user.perm,
                    id: user.id,
                    password: user.password,
                    secretString: null
                });
            });
        }));
        await Promise.all(proms);
        Promise.all(serversArrProms).then(() => BServer.startQueuedServers());
        return servers;
    }
    static generateRandomString(length: number) {
        return randomBytes(length).toString('hex');
    }
    static async refresh() {
        const proms = [];

        proms.push(DatabaseConnection.query({
            text: "SELECT * FROM servers"
        }).then(({ rows }) => {
            const ids: Set<number> = new Set();
            rows.forEach(dbServer => {
                // (id int NOT NULL AUTO_INCREMENT, path varchar(100), allowedusers JSON, description varchar(100), version varchar(15), autostart boolean, type varchar(15))
                ids.add(dbServer.id);
                const currentServer = servers.get(dbServer.id);
                if(!currentServer) {
                    // A new server was added to the database. Initialize it.
                    const allowedUsers = DatabaseConnection.type === 'mysql' ? JSON.parse(dbServer.allowedusers) : dbServer.allowedusers;
                    switch (dbServer.type) {
                    case 'vanilla':
                        servers.set(dbServer.id, new VanillaServer(dbServer.id, dbServer.description, dbServer.autostart, dbServer.path, dbServer.version, allowedUsers));
                        break;
                    case 'bdsx':
                        servers.set(dbServer.id, new BDSXServer(dbServer.id, dbServer.description, dbServer.autostart, dbServer.path, dbServer.version, allowedUsers));
                        break;
                    }
                        // Inform everyone that there is a new server
                    servers.get(dbServer.id).clobberAll();
                } else {
                    // Check if there were any changes to the server in the database
                    if(dbServer.path !== currentServer.path) {
                        currentServer.path = dbServer.path;
                        currentServer.updateCommand();
                    }
                    const changes: serverUpdate = {};
                    const au = DatabaseConnection.type === 'mysql' ? (dbServer.allowedusers) : JSON.stringify(dbServer.allowedusers);
                    if(au !== JSON.stringify(currentServer.allowedUsers)) {
                        // Not going to worry about dynamically updating, we'll update but we aren't sending packets.
                        const tmpallowedUsers = JSON.parse(au);
                        for (const user in tmpallowedUsers) {
                            currentServer.allowedUsers.set(parseInt(user), tmpallowedUsers[user]);
                        }
                        changes.allowedUsers = Array.from(currentServer.allowedUsers.entries()).map(([userId, val]) => {
                            const userObj = Server.dataFromId.get(userId);
                            return ({ id: userId, name: userObj.username, perm: userObj.perm, access: val });
                        });
                    }
                    if(dbServer.description !== currentServer.description) {
                        currentServer.description = dbServer.description;
                        changes.description = currentServer.description;
                    }
                    if(dbServer.version !== currentServer.version) {
                        // Not going to do a whole version switch. What are you doing mucking with version in the db??
                        currentServer.version = dbServer.version;
                        currentServer.clobberAll();
                    }
                    if(dbServer.autostart !== currentServer.autostart) {
                        // Again not going to start it if true because this is only applicable on startup.
                        currentServer.autostart = dbServer.autostart;
                        changes.properties = currentServer.properties;
                    }
                    if(dbServer.type !== currentServer.type) {
                        // Why would you do this? Seriously? Just don't. We'll do our best but no guarantees on this one.
                        currentServer.type = dbServer.type;
                    }
                }
            });
            servers.forEach(async server => {
                if(!ids.has(server.id)) {
                    await server.stop();
                    Server.dataFromId.forEach(async user => {
                        if (server.getUserPermissionLevel(user.id) & LocalPermissions.CAN_VIEW) {
                            if(user.socket) user.socket.emit('serverDeleted', { serverId: server.id });
                        }
                    });
                    servers.delete(server.id);
                }
            });
        }));

        proms.push(DatabaseConnection.query({
            text: "SELECT * FROM users"
        }).then(({ rows }) => {
            const ids: Set<number> = new Set();
            rows.forEach(user => {
                ids.add(user.id);
                const currentUser = Server.dataFromId.get(user.id);
                if(!currentUser) {
                    // New user added to db
                    Server.dataFromId.set(user.id, {
                        id: user.id,
                        username: user.username,
                        password: user.password,
                        perm: user.perm,
                        globalPermissions: user.globalpermissions,
                        selectedServer: null,
                        secretString: null
                    });
                } else {
                    // Check differences
                    if(user.username !== currentUser.username) {
                        currentUser.username = user.username;
                    }
                    if(user.password !== currentUser.password) {
                        currentUser.password = user.password;
                    }
                    if(user.perm !== currentUser.perm) {
                        currentUser.perm = user.perm;
                    }
                    if(user.globalpermissions !== currentUser.globalPermissions) {
                        currentUser.globalPermissions = user.globalpermissions;
                    }
                }
            });
            Server.dataFromId.forEach((val, id) => {
                if(!ids.has(id)) {
                    if(Server.dataFromId.get(id).socket) {
                        Server.idFromSocket.delete(Server.dataFromId.get(id).socket);
                        Server.dataFromId.get(id).socket.emit('logout');
                    }
                    Server.dataFromId.delete(id);
                }
            });
        }));
        proms.push(DatabaseConnection.query({
            text: "SELECT * FROM players"
        }).then(({ rows }) => {
            Player.xuidToPlayer = new Map();
            Player.nameToPlayer = new Map();
            rows.forEach(player => {
                new Player(player.username, player.xuid);
            });
        }));
        await Promise.all(proms);
        clobberUserList();
    }
}
