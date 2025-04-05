import { Env } from "@(-.-)/env";
import EventSource from "eventsource";
import { ofetch } from "ofetch";
import * as rxjs from "rxjs";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

const env = Env(
  z.object({
    GOJAM_API_PORT: z.coerce.number().int().default(9999),
    API_GATEWAY_PORT: z.coerce.number().int().default(63127),
    API_GATEWAY_API_KEY: z.string(),
    API_GATEWAY_DEBUG: z.coerce.boolean().optional(),
    RECORDING_DIRECTORY_PREFIX: z
      .string()
      .default("/var/local/jamulus/recordings"),
    UPLOAD_ENDPOINT_URL: z.string().optional(),
    UPLOAD_ENDPOINT_KEY: z.string().optional(),
  })
);

const seenIds = new Set<string>();

const eventSource = new EventSource(
  `http://localhost:${env.GOJAM_API_PORT}/events`
);

interface GojamEvent {
  newChatMessage?: {
    id: string;
    message: string;
    timestamp: string;
  };
  levels: number[];
  clients: {
    name: string;
    city: string;
    country: number;
    skillLevel: number;
    instrument: number;
  }[];
}

const events = new rxjs.Subject<GojamEvent>();

eventSource.onmessage = (event) => {
  events.next(JSON.parse(event.data));
};

eventSource.onerror = (event) => {
  console.error(event);
  process.exit(1);
};

const messages = events.pipe(
  rxjs.filter((event) => !!event.newChatMessage),
  rxjs.map((event) => event.newChatMessage!)
);

interface RpcMethod {
  "jamulusserver/setRecordingDirectory": {
    params: {
      recordingDirectory: string;
    };
    result: string;
  };
  "jamulusserver/getRecorderStatus": {
    params: {};
    result: {
      initialised: boolean;
      errorMessage?: string;
      enabled: boolean;
      recordingDirectory: string;
    };
  };
  "jamulusserver/startRecording": {
    params: {};
    result: "acknowledged";
  };
  "jamulusserver/stopRecording": {
    params: {};
    result: "acknowledged";
  };
}

interface JsonRpcResponse<T> {
  result: T;
}

async function rpc<K extends keyof RpcMethod>(
  method: K,
  params: RpcMethod[K]["params"]
): Promise<RpcMethod[K]["result"]> {
  const { result } = await ofetch<JsonRpcResponse<RpcMethod[K]["result"]>>(
    `http://localhost:${env.API_GATEWAY_PORT}/rpc/${method}`,
    {
      method: "POST",
      headers: { "x-api-key": env.API_GATEWAY_API_KEY },
      body: { params },
    }
  );
  if (env.API_GATEWAY_DEBUG) {
    console.debug(method, params, result);
  }
  return result;
}

async function sendChat(message: string) {
  await ofetch(`http://localhost:${env.GOJAM_API_PORT}/chat`, {
    method: "POST",
    body: { message },
  });
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function pollFor(description: string, f: () => Promise<boolean>) {
  for (let i = 0; i < 10; i++) {
    if (await f()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function recordSession(sessionId: string) {
  try {
    const dir = env.RECORDING_DIRECTORY_PREFIX + "/" + sessionId;
    log(`Starting recording session in ${dir}`);

    await sendChat(`starting recording session...`);
    await rpc("jamulusserver/setRecordingDirectory", {
      recordingDirectory: dir,
    });
    log("Recording directory change requested");

    await pollFor("recording directory to be set", async () => {
      const status = await rpc("jamulusserver/getRecorderStatus", {});
      return status.recordingDirectory === dir;
    });
    log("Recording directory set");

    await rpc("jamulusserver/startRecording", {});
    log("Recording start requested");

    await pollFor("recording to start", async () => {
      const status = await rpc("jamulusserver/getRecorderStatus", {});
      return status.enabled;
    });
    await sendChat(`your recording id is: ${sessionId}`);
    if (!env.UPLOAD_ENDPOINT_URL) {
      await sendChat(
        `WARNING: upload endpoint not set, recording will not be uploaded`
      );
    }

    await rxjs.firstValueFrom(
      rxjs.merge(
        messages.pipe(rxjs.filter((m) => !!m.message.match(/>\s+\/stop\s*$/))),
        rxjs.interval(1000).pipe(
          rxjs.scan((a, b) => a - 1, 601),
          rxjs.tap((a) => {
            const onError = (e: Error) => {
              console.error("error sending chat message", e);
            };
            if (a % 60 === 0) {
              sendChat(`recording time remaining: ${a / 60} minutes.`).catch(
                onError
              );
            } else if (a <= 30 && a % 10 === 0) {
              sendChat(`recording time remaining: ${a} seconds.`).catch(
                onError
              );
            }
          }),
          rxjs.filter((a) => a <= 0)
        )
      )
    );

    await rpc("jamulusserver/stopRecording", {});
    await pollFor("recording to stop", async () => {
      const status = await rpc("jamulusserver/getRecorderStatus", {});
      return !status.enabled;
    });
    await sendChat(`recording stopped`);

    // Upload the recording to the server
    const url = await uploadRecording(sessionId, dir);
    log(`${url}`);
  } catch (e) {
    await sendChat(`An error occurred while recording...`);
    throw e;
  }
}

async function uploadRecording(sessionId: string, dir: string) {
  return "TODO";

  // 1. Wait until the recording directory contains a file matching `**/.lof`.
  // 2. Generate a zip file using the "zip" command, piping the output to stdout.
  // 3. Stream the zip file to the upload endpoint using a PUT request.
  //       Add query param: ?path=multitrack/<sessionId>.zip
  //       Set the "Content-Type" header to "application/zip".
  //       Set the "Authorization" header to "Bearer <UPLOAD_ENDPOINT_KEY>".
  // The response contains "url" fields.
}

async function cleanupRecordingFolders() {
  // Do an rm -rf on each subdirectory of the recording directory prefix,
  // but only if the directory is older than 1 hour.
}

async function main() {
  for (;;) {
    try {
      const { id, message } = await rxjs.firstValueFrom(
        messages.pipe(
          rxjs.filter(({ message }) => !!message.match(/>\s+\/start\s*$/))
        )
      );
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const sessionId =
        new Date(Date.now() - 60e3 * new Date().getTimezoneOffset())
          .toISOString()
          .replace(/:/g, "-")
          .split(".")[0] +
        "-" +
        uuidv7().split("-").pop();
      log(`Recording session ${sessionId}`);

      try {
        await recordSession(sessionId);
      } catch (e) {
        log(`Error recording session ${sessionId}`);
        console.error(e);
      }
    } finally {
      await cleanupRecordingFolders();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

main();
