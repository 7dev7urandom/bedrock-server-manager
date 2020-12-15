# bedrock-server-manager
Manages bedrock servers from a web api using sockets

## Install

```sh
npm i
tsc
node index.js util hash <your chosen admin password>
```

Create db tables

```sql
CREATE DATABASE bsm;
USE bsm;
CREATE TABLE users (id int NOT NULL, username varchar(20) NOT NULL, password char(32) NOT NULL, perm varchar(20), globalpermissions smallint, PRIMARY KEY(id));
CREATE TABLE players (username varchar(15), xuid varchar(20));
CREATE TABLE servers (id int NOT NULL, path varchar(100), allowedusers JSON, description varchar(100), version varchar(15), autostart boolean, PRIMARY KEY(id));
INSERT INTO users (username, password, perm, globalpermissions) VALUES ('admin', '<md5 hash of password acquired from script above'>, 255);
INSERT INTO servers (path, allowedusers, description, version, autostart) VALUES ('<path/to/server/folder>', '{ "1": 255 }', 'My first server'. '1.16.200', true);
```

## Run

```sh
node index.js
```

`localhost:3000`

