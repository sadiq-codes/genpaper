import { spawn, type StdioOptions } from "child_process";
import { createHmac } from "crypto";
import { closeSync, mkdirSync, openSync } from "fs";
import path from "path";

function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveLaunchCommand(runId: string): string {
  const template = process.env.GENERATION_ONE_SHOT_LAUNCH_CMD;
  if (template && template.trim().length > 0) {
    if (template.includes("{RUN_ID}")) {
      return template.replaceAll("{RUN_ID}", runId);
    }
    return `${template} --run-id ${quoteArg(runId)}`;
  }

  if (process.env.NODE_ENV !== "production") {
    return `bun run worker:generation:once -- --run-id ${quoteArg(runId)}`;
  }

  throw new Error(
    "Missing GENERATION_ONE_SHOT_LAUNCH_CMD in production. " +
      "Set a command template containing {RUN_ID}."
  );
}

type WorkerLogMode = "ignore" | "inherit" | "file";

interface WorkerLogConfig {
  stdio: StdioOptions;
  logPath?: string;
  cleanup?: () => void;
}

function resolveWorkerLogMode(): WorkerLogMode {
  const defaultMode: WorkerLogMode =
    process.env.NODE_ENV !== "production" ? "inherit" : "ignore";
  const raw = (process.env.GENERATION_ONE_SHOT_LOG_MODE || defaultMode)
    .trim()
    .toLowerCase();

  if (raw === "ignore" || raw === "inherit" || raw === "file") {
    return raw;
  }

  console.warn(
    `[worker-launcher] Invalid GENERATION_ONE_SHOT_LOG_MODE="${raw}", falling back to "${defaultMode}"`
  );
  return defaultMode;
}

function resolveWorkerLogConfig(runId: string): WorkerLogConfig {
  const mode = resolveWorkerLogMode();

  if (mode === "inherit") {
    return { stdio: "inherit" };
  }

  if (mode === "file") {
    const configuredDir =
      process.env.GENERATION_ONE_SHOT_LOG_DIR || ".logs/generation-workers";
    const logDir = path.isAbsolute(configuredDir)
      ? configuredDir
      : path.join(process.cwd(), configuredDir);
    mkdirSync(logDir, { recursive: true });

    const logPath = path.join(logDir, `${runId}.log`);
    const fd = openSync(logPath, "a");
    return {
      stdio: ["ignore", fd, fd],
      logPath,
      cleanup: () => {
        try {
          closeSync(fd);
        } catch {
          // no-op
        }
      },
    };
  }

  return { stdio: "ignore" };
}

async function launchViaWebhook(runId: string): Promise<void> {
  const url = process.env.GENERATION_ONE_SHOT_LAUNCH_URL;
  if (!url) {
    throw new Error("Missing GENERATION_ONE_SHOT_LAUNCH_URL for webhook mode");
  }

  const token = process.env.GENERATION_ONE_SHOT_LAUNCH_TOKEN;
  if (!token) {
    throw new Error("Missing GENERATION_ONE_SHOT_LAUNCH_TOKEN for webhook mode");
  }
  const signatureSecret = process.env.GENERATION_ONE_SHOT_HMAC_SECRET || token;
  const payload = JSON.stringify({ runId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signatureSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Genpaper-Timestamp": timestamp,
      "X-Genpaper-Signature": signature,
    },
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Worker launch webhook failed: HTTP ${response.status}${text ? ` - ${text}` : ""}`
    );
  }
}

async function launchViaCommand(runId: string): Promise<void> {
  const command = resolveLaunchCommand(runId);
  const logConfig = resolveWorkerLogConfig(runId);
  if (logConfig.logPath) {
    console.log(`[worker-launcher] one-shot worker log: ${logConfig.logPath}`);
  }

  const child = spawn(command, {
    shell: true,
    detached: true,
    stdio: logConfig.stdio,
    env: process.env,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve();
      }, 500);

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code && code !== 0) {
          reject(
            new Error(
              `Launch command exited early with code ${code}${
                signal ? ` (signal ${signal})` : ""
              }`
            )
          );
          return;
        }
        resolve();
      });
    });
  } finally {
    logConfig.cleanup?.();
  }

  child.unref();
}

export async function launchOneShotWorkerProcess(runId: string): Promise<void> {
  await launchViaCommand(runId);
}

export async function launchOneShotWorker(runId: string): Promise<void> {
  const mode = (process.env.GENERATION_ONE_SHOT_LAUNCH_MODE || "cmd")
    .trim()
    .toLowerCase();

  if (mode === "none") {
    return;
  }

  if (mode === "webhook") {
    await launchViaWebhook(runId);
    return;
  }

  await launchOneShotWorkerProcess(runId);
}
