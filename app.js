"use strinct";

const fs = require("fs");
const { exec } = require("child_process");

const appConfig = JSON.parse(fs.readFileSync("bot_settings.json"));
const tgToken = appConfig.telegram_token;
const googleOptions = { keyFilename: appConfig.google_api_json };
const bucketName = appConfig.google_storage_bucket;

const TelegramBot = require("node-telegram-bot-api");
const { SpeechClient } = require("@google-cloud/speech");
const { Storage } = require('@google-cloud/storage');
const { resolve } = require("path");

const storageClient = new Storage(googleOptions);

const speechClient = new SpeechClient(googleOptions);


async function startBot() {
  await setupFolder();
  // Create a bot that uses "polling" to fetch new updates
  const bot = new TelegramBot(tgToken, { polling: true });

  console.log("\n")
  logString("Avviato")
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith("/start")) {
      bot.sendMessage(chatId, "Avviato");
    }

    if (msg.audio || msg.voice) {
      logString("received audio from user", msg.from.first_name, "(@" + msg.from.username + ")");
      const fileId = msg.audio ? msg.audio.file_id : msg.voice.file_id;
      bot.sendMessage(chatId, "Ricevuto audio, elaboro...");
      const fileName = await bot.downloadFile(fileId, "files");
      bot.sendMessage(chatId, await transcribeAudioFile(fileName), { reply_to_message_id: msg.message_id});
    } else {
      bot.sendMessage(chatId, "Invia un file audio");
    }
  });
}

async function transcribeAudioFile(originalFilePath) {
  const filePath = await convertAudioFile(originalFilePath);
  try {
    const fileName = await uploadFileToGStorage(filePath);
    const audioURI = `gs://${bucketName}/${fileName}`;
    //const audioURI = 'gs://cloud-samples-data/speech/brooklyn_bridge.raw';

    // The audio file's encoding, sample rate in hertz, and BCP-47 language code
    const audio = {
      uri: audioURI,
    };
    const config = {
      encoding: "FLAC",
      sampleRateHertz: 16000,
      languageCode: "it-IT",
    };
    const request = {
      audio: audio,
      config: config,
    };

    // Detects speech in the audio file
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join("\n");
    logString(`\tTranscription: ${transcription}`);

    return transcription.length > 0 ? transcription : "Impossibile estrarre il parlato dall'audio";
  } finally {
    // deletes local file
    try {
      fs.unlink(originalFilePath, () => { });
      fs.unlink(filePath, () => { });
    } catch (ex) {
      logString(ex);
    }

    // deletes file from GStorage
    deleteFileFromGStorage(filePath);
  }
}

async function uploadFileToGStorage(filePath) {
  const fileName = filePath.split("/").pop();
  await storageClient.bucket(bucketName).upload(filePath, {
    destination: fileName,
  });

  return fileName;
}

async function deleteFileFromGStorage(filePath) {
  const fileName = filePath.split("/").pop();
  try {
    await storageClient.bucket(bucketName).file(fileName).delete();
  } catch (ex) {
    logString(ex);
  }
}

async function convertAudioFile(filePath) {
  return new Promise((resolve, reject) => {
    const cmdString = `ffmpeg -i "${filePath}" -map 0:a:0 -c:a flac -ar 16k -ac 1 "${filePath}.flac"`;
    exec(cmdString, (error, stdout) => {
      if (error) {
        logString(`error: ${error.message}`);
        reject(error);
        return;
      }
      // logString(`stdout: ${stdout}`);
      resolve(filePath + ".flac");
    });
  });
}

async function setupFolder() {
  return new Promise(resolve => {
    fs.rmdir("files", { recursive: true }, () => {
      fs.mkdirSync("files");
      resolve();
    });
  });

}

function logString(...msgs) {
  let d = new Date();
  let finalString = `${("" + d.getDate()).padStart(2, "0")}/${(d.getMonth() + 1 + "").padStart(2, "0")}/${d.getFullYear()} ${("" + d.getHours()).padStart(2, "0")}:${("" + d.getMinutes()).padStart(2, "0")}:${("" + d.getSeconds()).padStart(2, "0")} - ${msgs.join(" ")}`;

  console.log(finalString);
}

startBot();