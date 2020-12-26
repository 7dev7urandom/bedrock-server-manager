import { timeStamp } from "console";

const postgredb = require('pg');
const mysqldb = require('mysql');
// const DB = ['servers', 'users', 'worlds'];

// Currently using DB for everything. May not be best for performance

export default class DatabaseConnection {
    static numOfQuerys = 0;
    static connection: any;
    static type: 'mysql' | 'postgresql';
    static connect(config): Promise<void> {
        return new Promise((resolve, reject) => {
            if(this.connection) {
                reject();
                return;
            }
            // config.db.software = config.db.software || 'postgresql';
            this.type = config.db.software.toLowerCase() || 'postgresql';
            if(this.type === 'mysql') {
                this.connection = mysqldb.createConnection(config.db);
                this.connection.connect((err) => {
                    if (err) throw err;
                    // console.log("DB connected successfully");
                    resolve();
                })
            } else if (this.type === "postgresql") {
                this.connection = new postgredb.Client(config.db);
                this.connection.connect()
                .then(() => {
                    //console.log("DB connected successfully")
                    resolve();
                })
                .catch((err) => {
                    reject("DB connection error. Aborting. Error: " + err + " using config " + config.db);
                    process.exit(1);
                });
            } else {
                console.error("Unrecognized db server " + this.type);
            }
        })
    }
    static async query(object) {
        // console.log("Database query " + object.text + " with values " + JSON.stringify(object.values));
        if(this.type === 'postgresql')
            return await this.connection.query(object);
        if(this.type === 'mysql')
            return new Promise((r, rej) => {
                let query: string = object.text;
                let args = [];
                query = query.replace(/\$(\d)/g, (match, num) => {
                    args.push(object.values[parseInt(num) - 1]);
                    return '?';
                });
                this.connection.query(query, args, (err, res) => {
                    if (err) rej(err);
                    r({ rows: res });
                });
            });
    }
    static async insertQueryReturnId(object) {
        if(this.type === 'postgresql') {
            object.text += " RETURNING id";
            return (await this.connection.query(object)).rows[0].id;
        }
        if(this.type === 'mysql')
            return new Promise((r, rej) => {
                let query: string = object.text;
                let args = [];
                query = query.replace(/\$(\d)/g, (match, num) => {
                    args.push(object.values[parseInt(num) - 1]);
                    return '?';
                });
                this.connection.query(query, args, (err, res) => {
                    if (err) {
                        rej(err);
                        return;
                    }
                    console.log(JSON.stringify(res));
                    r(res.insertId);
                });
            });
    }
}