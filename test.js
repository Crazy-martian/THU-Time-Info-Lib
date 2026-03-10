import { InfoHelper } from "./thu-info-lib/dist/index.js";
import * as network from "./thu-info-lib/dist/utils/network.js";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import readline from "readline";

const gradeCountedForAllCredits = new Set([
    "A+",
    "A",
    "A-",
    "B+",
    "B",
    "B-",
    "C+",
    "C",
    "C-",
    "D+",
    "D",
    "P",
    "EX",
]);

const summarizeReport = (report) => {
    let totalCredits = 0;
    let totalPoints = 0;
    let allCredits = 0;

    for (const course of report) {
        if (!Number.isNaN(course.point)) {
            totalCredits += course.credit;
            totalPoints += course.point * course.credit;
        }
        if (!Number.isNaN(course.credit) && gradeCountedForAllCredits.has(course.grade)) {
            allCredits += course.credit;
        }
    }

    return {
        totalCredits,
        totalPoints,
        allCredits,
        gpa: totalCredits === 0 ? NaN : totalPoints / totalCredits,
    };
};

const formatNumber = (value, digits = 2) => (Number.isNaN(value) ? "N/A" : value.toFixed(digits));
  
const helper = new InfoHelper();

const stateFile = path.resolve(".thu-info-state.json");
const credentialsFile = path.resolve(".username_and_password.json");

const loadState = () => {
    try {
        return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
        return {};
    }
};

const saveState = (patch) => {
    const next = {
        ...loadState(),
        ...patch,
    };
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2), "utf8");
};

const loadCredentials = () => {
    try {
        const { username, password } = JSON.parse(fs.readFileSync(credentialsFile, "utf8"));

        if (!username || !password) {
            throw new Error("Missing username or password");
        }

        return {
            userId: username,
            password,
        };
    } catch (error) {
        throw new Error(
            `Failed to read ${path.basename(credentialsFile)}. Expected JSON like { \"username\": \"...\", \"password\": \"...\" }. ${error.message}`,
        );
    }
};

const defaultFingerprint = crypto.randomUUID().replace(/-/g, "");

const persistedState = loadState();
helper.fingerprint = persistedState.fingerprint || defaultFingerprint;
saveState({ fingerprint: helper.fingerprint });

for (const [key, value] of Object.entries(persistedState.cookies || {})) {
    network.setCookie(key, value);
}
  
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
  
// 配置 2FA 方法选择钩子  
helper.twoFactorMethodHook = async (hasWeChatBool, phone, hasTotp) => {
    console.log("可用的 2FA 方法:");
    if (hasWeChatBool) console.log("1. 微信企业微信");
    if (phone !== null) console.log("2. 短信验证");
    if (hasTotp) console.log("3. TOTP 动态验证码");

    return new Promise((resolve) => {
        rl.question("请选择 2FA 方法 (1/2/3): ", (answer) => {
            switch (answer) {
                case "1": resolve("wechat"); break;
                case "2": resolve("mobile"); break;
                case "3": resolve("totp"); break;
                default: resolve(undefined);
            }
        });
    });
};
  
// 配置 2FA 验证码钩子  
helper.twoFactorAuthHook = async () => {
    return new Promise((resolve) => {
        rl.question("请输入验证码: ", (code) => {
            resolve(code);
        });
    });
};

helper.clearCookieHandler = async () => {
    saveState({ cookies: {} });
    console.log("clearing cookies");
};

helper.trustFingerprintHook = async () => true;

helper.trustFingerprintNameHook = async () => `THU Info Node (${os.hostname()})`;

helper.loginErrorHook = (e) => {
  console.error("loginErrorHook:", e);
};

const ensureCredentialsFile = async () => {
    if (fs.existsSync(credentialsFile)) {
        console.log(`凭据文件 ${path.basename(credentialsFile)} 已存在。`);
        return;
    }

    console.log(`凭据文件 ${path.basename(credentialsFile)} 不存在，需要创建。`);
    console.log('请提供清华信息门户的用户名和密码（信息将保存在本地文件中）');
    console.log('注意：密码输入将显示为明文。');

    return new Promise((resolve) => {
        rl.question('学号: ', (username) => {
            rl.question('密码: ', (password) => {
                const credentials = { username, password };
                fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 4), 'utf8');
                console.log(`凭据已保存到 ${path.basename(credentialsFile)}`);
                resolve();
            });
        });
    });
};

try {
    await ensureCredentialsFile();
    await helper.login(loadCredentials());
    saveState({ cookies: { ...network.cookies }, fingerprint: helper.fingerprint });
    console.log("登录成功！");

    await helper.switchLang("zh").catch(() => {});
    saveState({ cookies: { ...network.cookies }, fingerprint: helper.fingerprint });

    console.log("Trying to get GPA/report...");
    const report = await helper.getReport(false, true, 1);
    saveState({ cookies: { ...network.cookies }, fingerprint: helper.fingerprint });
    const summary = summarizeReport(report);

    console.log("GPA 查询成功！");
    console.log({
        courseCount: report.length,
        gpa: formatNumber(summary.gpa, 3),
        totalCredits: formatNumber(summary.totalCredits, 1),
        allCredits: formatNumber(summary.allCredits, 1),
        totalPoints: formatNumber(summary.totalPoints, 3),
    });

    console.log("最近 10 门课程:");
    console.table(
        report.slice(-10).map((course) => ({
            semester: course.semester,
            name: course.name,
            grade: course.grade,
            credit: course.credit,
            point: Number.isNaN(course.point) ? "N/A" : course.point,
        })),
    );
} catch (error) {
    console.error("登录失败:", error.message);
} finally {
    saveState({ cookies: { ...network.cookies }, fingerprint: helper.fingerprint });
    rl.close();
}
