import { ChildProcess } from "child_process";
import { IPty } from "node-pty";

export class ServerProcess {
    proc: any;
    pid: number;
    constructor(process) {
        this.proc = process;
        this.pid = this.proc.pid;
    }
    write(input: string) {
        if(this.proc.write) {
            this.proc.write(input);
        } else {
            this.proc.stdin.write(input);
        }
    }
    on(event: 'data', listener: (data: string) => void): void;
    on(event: 'exit', listener: (exitCode: number, signal?: number) => void): void;
    on(event, listener): void {
        if(event === 'data') {
            if (this.proc.onData) {
                // IPty
                const procNew: IPty = this.proc;
                procNew.onData((str) => {
                    console.log(str);
                    listener(str);
                });
            } else {
                // ChildProcess
                const procNew: ChildProcess = this.proc;
                procNew.stdout.on('data', listener);
                procNew.stderr.on('data', listener);
            }
        } else {
            if (this.proc.onExit) {
                // IPty
                const procNew: IPty = this.proc;
                procNew.onExit(listener);
            } else {
                // ChildProcess
                const procNew: ChildProcess = this.proc;
                procNew.on('exit', listener);
            }
        }
    }
    kill(signal?: NodeJS.Signals | number | string): void {
        this.proc.kill(signal);
    }

}
// class ServerProcess<T extends IPty> {
    
// }