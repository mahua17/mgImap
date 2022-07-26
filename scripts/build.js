const rimraf = require("rimraf");
const { execSync } = require("child_process");
// 删除原来的dist目录
rimraf.sync("./dist");
// 执行tsc
execSync("node node_modules/typescript/bin/tsc");


