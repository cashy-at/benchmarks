const sharp = require("sharp");
const FormData = require("form-data");
const fs = require("node:fs/promises");
const path = require("node:path");
const { constants, createReadStream } = require("node:fs");

async function benchmark() {
  const examplesPath = path.join(__dirname, "image-examples");

  let exampleImages;
  if (await fs.stat(examplesPath, constants.R_OK).catch(() => false)) {
    exampleImages = await getExamples(examplesPath);
  } else {
    exampleImages = await generateExamples(examplesPath);
  }

  console.log("Uploading assets to storyblok.");
  const uploadPromises = [];
  for (const image of exampleImages) {
    uploadPromises.push(uploadStoryblokImage(image));
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("Finished storyblok upload.");

  const storyblokImages = await Promise.all(uploadPromises);
  for (const image of storyblokImages) {
    for (const width of testWidths) {
      const start = Date.now();
      const res = await fetch(
        image.url + `/${width}x0/filters:format(webp):quality(75)`,
      );
      await res.arrayBuffer();
      console.log(Date.now() - start, image);
    }
  }
}

async function generateExamples(examplesPath) {
  console.log("Generating examples.");
  await fs.mkdir(examplesPath);
  const imagesPath = path.join(__dirname, "images");
  const exampleImages = [];
  for (const fileName of await fs.readdir(imagesPath)) {
    console.log("  " + fileName);
    const filePath = path.join(imagesPath, fileName);
    const baseName = path.parse(fileName).name;

    for (const width of sourceImageWidths) {
      async function resize(format, opts) {
        const prePath = path.join(
          examplesPath,
          `${baseName}-${width}.${format}`,
        );

        let image = sharp(filePath).resize(width);
        image = image[format](opts);
        image = await image.toFile(prePath);

        const genPath = path.join(
          examplesPath,
          `${baseName}-${width}x${image.height}.${format}`,
        );

        await fs.rename(prePath, genPath);
        exampleImages.push({
          width,
          height: image.height,
          format,
          path: genPath,
        });
      }

      await Promise.all([
        resize("webp"),
        resize("png", { quality: 80 }),
        resize("jpeg"),
      ]);
    }
  }
  console.log("Finished generating examples.");

  return exampleImages;
}

async function getExamples(examplesPath) {
  const fileNames = await fs.readdir(examplesPath);

  return fileNames.map((n) => {
    const sizeString = n.slice(n.lastIndexOf("-") + 1, n.lastIndexOf("."));
    const [width, height] = sizeString.split("x");

    return {
      width: Number.parseInt(width),
      height: Number.parseInt(height),
      format: path.parse(n).ext.slice(1),
      path: path.join(examplesPath, n),
    };
  });
}

async function uploadStoryblokImage(image) {
  const headers = {
    ["content-type"]: "application/json",
    authorization: sbAuthToken,
  };

  const getUploadUrlResponse = await fetch(
    `https://mapi.storyblok.com/v1/spaces/${spaceId}/assets/`,
    {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        filename: path.basename(image.path),
        size: image.width + "x" + image.height,
      }),
    },
  );

  const form = new FormData();
  const uploadUrlResponse = await getUploadUrlResponse.json();
  // apply all fields from the signed response object to the second request
  for (let key in uploadUrlResponse.fields) {
    form.append(key, uploadUrlResponse.fields[key]);
  }
  // also append the file read stream
  form.append("file", createReadStream(image.path));
  // submit your form
  const { id } = await new Promise((resolve, reject) =>
    form.submit(uploadUrlResponse.post_url, async (error) => {
      if (error) {
        reject(error);
      }

      const finaliseResponse = await fetch(
        `https://mapi.storyblok.com/v1/spaces/${spaceId}/assets/${uploadUrlResponse.id}/finish_upload`,
        { headers },
      );

      if (!finaliseResponse.ok) {
        console.error(finaliseResponse.status, await finaliseResponse.text());
        reject(new Error("Upload failed."));
      } else {
        resolve(await finaliseResponse.json());
      }
    }),
  );

  const getAssetResponse = await fetch(
    `https://mapi.storyblok.com/v1/spaces/${spaceId}/assets/${id}`,
    { headers },
  );

  const asset = await getAssetResponse.json();
  return { url: asset.filename.replace("s3.amazonaws.com/", ""), ...image };
}

const providers = [];
const sourceImageWidths = [1080, 2048, 3840];
const testWidths = [640, 750, 828, 1080, 1200, 1560];
const spaceId = 247220;
const sbAuthToken = "HVr29ALQgmvg33sKcrT3kQtt-209491-1PKVJoSWzRZesG_QGHZ2";

benchmark().then(
  () => {
    console.log("Finished benchmarking.");
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
