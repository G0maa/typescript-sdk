import { BatchInterceptor } from "@mswjs/interceptors";
// Somehow this doesn't work. I get an error that the module is not found.
// import { nodeInterceptors } from "@mswjs/interceptors/presets/node";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { XMLHttpRequestInterceptor } from "@mswjs/interceptors/XMLHttpRequest";
import { FetchInterceptor } from "@mswjs/interceptors/fetch";
// import { Buffer } from "node:buffer";

// core Keploy functions
import { getExecutionContext } from "../../src/context";
import { MODE_OFF, MODE_RECORD, MODE_TEST } from "../../src/mode";
import { HTTP, V1_BETA2 } from "../../src/keploy";
import { putMocks } from "../../mock/utils";
import { stringToBinary } from "../../src/util";
import { DataBytes } from "../../proto/services/DataBytes";
import { MockIds } from "../../mock/mock";
import { Mock } from "../../proto/services/Mock";
import { StrArr } from "../../proto/services/StrArr";

// This is a prototype for GSoC, requested by Neha.
// Generally I kept the original inegration from node-fetch
const interceptor = new BatchInterceptor({
  name: "my-interceptor",
  interceptors: [
    new ClientRequestInterceptor(),
    new XMLHttpRequestInterceptor(),
    new FetchInterceptor(),
  ],
});

interceptor.apply();

// From ReadableStream<Uint8Array> to string: (because the interface says so)
async function streamToString(stream?: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  const reader = stream.getReader();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // result += value.toString();
    result += Buffer.from(value).toString("utf-8");
    // result += new TextDecoder("utf-8").decode(value);
    // console.log("result", result);
    // console.log("value", value);
  }
  return result;
}

function getHeadersInit(headers: { [k: string]: string[] }): {
  [k: string]: string;
} {
  const result: { [key: string]: string } = {};
  for (const key in headers) {
    result[key] = headers[key].join(", ");
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interceptor.on("request", (request, requestId) => {
  if (
    getExecutionContext() == undefined ||
    getExecutionContext().context == undefined
  ) {
    console.error("keploy context is not present to mock dependencies");
    return;
  }
  const ctx = getExecutionContext().context;
  console.log("ctx.mode at .on('request')", ctx.mode);

  // to-do: name the interceptor based on the request
  // const meta = {
  //   name: "node-fetch",
  //   url: request.url,
  //   // options: options,
  //   type: "HTTP_CLIENT",
  // };

  switch (ctx.mode) {
    case MODE_TEST:
      // to-do, dummy response for now.
      // request.respondWith(
      //   new Response(
      //     JSON.stringify({
      //       firstName: "John",
      //       lastName: "Maverick",
      //     }),
      //     {
      //       status: 201,
      //       statusText: "Created",
      //       headers: {
      //         "Content-Type": "application/json",
      //       },
      //     }
      //   )
      // );
      break;
    case MODE_RECORD:
      // I'm assuming I will deal with this in .on("response")
      break;
    case MODE_OFF:
      break;
    default:
      console.debug(
        `keploy mode '${ctx.mode}' is invalid. Modes: 'record' / 'test' / 'off'(default)`
      );
  }
});

interceptor.on("response", async (response, request) => {
  if (
    getExecutionContext() == undefined ||
    getExecutionContext().context == undefined
  ) {
    console.error("keploy context is not present to mock dependencies");
    return;
  }
  const ctx = getExecutionContext().context;
  console.log("ctx.mode at .on('response')", ctx.mode);
  // This means options that are in the function call itself,
  // since this is a general interceptor, I'm not sure if we can get them.
  // const options: any = {
  //   method: request.method,
  //   headers: request.headers.entries(),
  //   body,
  //   redirect: request.redirect,
  //   signal: request.signal,
  // };

  const meta = {
    name: "node-fetch",
    url: request.url,
    // options: options,
    type: "HTTP_CLIENT",
  };

  switch (ctx.mode) {
    case MODE_TEST:
      // This is dealt with on .on("request")
      break;
    case MODE_RECORD:
      // Unsure if I need to clone
      const clonedResp = response.clone();
      const clonedReq = request.clone();

      // This does not work, even breaks the code
      // const json = await clonedResp.json();
      // console.log("json", json);

      // const reqBody = await request.clone().json();
      const reqBody = await streamToString(clonedReq.body);
      const resBody = await streamToString(clonedResp.body);

      console.log("reqBody", reqBody);
      console.log("resBody", resBody);

      // maybe try this later...
      // const test = JSON.parse(JSON.stringify(clonedReq));

      // sadly couldn't use the function in the express integration
      const resHeadersArr = {} as { [key: string]: StrArr };
      clonedResp.headers.forEach((value, key) => {
        resHeadersArr[key] = { Value: [value] };
      });

      const reqHeadersArr = {} as { [key: string]: StrArr };
      clonedReq.headers.forEach((value, key) => {
        reqHeadersArr[key] = { Value: [value] };
      });

      const rinit = {
        headers: resHeadersArr,
        status: clonedResp.status,
        statusText: clonedResp.statusText,
      };

      const httpMock: Mock = {
        Version: V1_BETA2,
        Name: ctx.testId,
        Kind: HTTP,
        Spec: {
          Metadata: meta,
          Req: {
            URL: request.url,
            // Body: reqBody,
            Body: "",
            Header: reqHeadersArr,
            Method: request.method,
            // URLParams:
          },
          Res: {
            StatusCode: clonedResp.status,
            Header: resHeadersArr,
            // Body: resBody,
            Body: "",
          },
        },
      };

      if (ctx.fileExport === true) {
        MockIds[ctx.testId] !== true ? putMocks(httpMock) : "";
      } else {
        ctx.mocks.push(httpMock);
        // ProcessDep(meta, [respData, rinit]);
        const res: DataBytes[] = [];
        // for (let i = 0; i < outputs.length; i++) {
        res.push({ Bin: stringToBinary(JSON.stringify("")) });
        res.push({ Bin: stringToBinary(JSON.stringify(rinit)) });
        // }
        ctx.deps.push({
          Name: meta.name,
          Type: meta.type,
          Meta: meta,
          Data: res,
        });
      }
      break;
    case MODE_OFF:
      break;
    default:
      console.debug(
        `keploy mode '${ctx.mode}' is invalid. Modes: 'record' / 'test' / 'off'(default)`
      );
  }
});

// Does this have to be caleld before .on()?
// export default interceptor.apply();
