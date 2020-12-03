import DatabaseConnection from './DatabaseConnection';

export default class Player {
    static players: Player[] = [];
    static xuidToPlayer: Map<string, Player> = new Map();
    static nameToPlayer: Map<string, Player> = new Map();
    xuid: string;
    username: string;
    constructor(username, xuid, addToDb = false) {
        this.username = username;
        this.xuid = xuid;
        Player.players.push(this);
        Player.xuidToPlayer.set(xuid, this);
        Player.nameToPlayer.set(username, this);
        if(addToDb) {
            DatabaseConnection.query({
                text: "INSERT INTO players (username, xuid) VALUES ($1, $2) ON CONFLICT (xuid) DO UPDATE SET username = $1",
                values: [username, xuid]
            });
        }
    }
}