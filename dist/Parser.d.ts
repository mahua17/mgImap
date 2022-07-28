/// <reference types="node" />
/// <reference types="node" />
import { EventEmitter } from "events";
export default class Parser extends EventEmitter {
    private logger?;
    private data?;
    private body?;
    constructor(logger?: (...args: any[]) => any);
    parse(data: Buffer): void;
    handleMessage(): void;
    private resUntagged;
    private resTagged;
    private resContinue;
}
