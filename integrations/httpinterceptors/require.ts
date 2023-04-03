import { BatchInterceptor } from "@mswjs/interceptors";
// Somehow this doesn't work. I get an error that the module is not found.
// import { nodeInterceptors } from "@mswjs/interceptors/presets/node";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { XMLHttpRequestInterceptor } from "@mswjs/interceptors/XMLHttpRequest";
import { FetchInterceptor } from "@mswjs/interceptors/fetch";
import { getReasonPhrase } from "http-status-codes";

// core Keploy functions
import { getExecutionContext } from "../../src/context";
import { MODE_OFF, MODE_RECORD, MODE_TEST } from "../../src/mode";
import { HTTP, V1_BETA2 } from "../../src/keploy";
import { putMocks } from "../../mock/utils";
import { ProcessDep, stringToBinary } from "../../src/util";
import { DataBytes } from "../../proto/services/DataBytes";
import { MockIds } from "../../mock/mock";
import { Mock } from "../../proto/services/Mock";
import { StrArr } from "../../proto/services/StrArr";
import { getResponseHeader } from "../express/middleware";

// This is a prototype for GSoC, "indirectly" recommended by Neha.
// Generally I kept the original inegration from node-fetch
// Stuck with:
// 1. request.text() & response.text() results in weird characters
// 2. I get "Keploy context is not present to mock dependencies" error
// 3. I get Invalid responose body while trying to fetch <url>: Premature close
//    - regardless of the type of the body & the headers are formatted correctly.

const interceptor = new BatchInterceptor({
  name: "my-interceptor",
  interceptors: [
    new ClientRequestInterceptor(),
    new XMLHttpRequestInterceptor(),
    new FetchInterceptor(),
  ],
});

interceptor.apply();

function getHeadersInit(headers: { [k: string]: string[] }): {
  [k: string]: string;
} {
  const result: { [key: string]: string } = {};
  for (const key in headers) {
    result[key] = headers[key].join(", ");
  }
  return result;
}

// sadly couldn't use the function in the express integration
function fromHeadersToKeploy(headers: Headers) {
  const headersArr: { [key: string]: StrArr } = {};
  // const headersArr: { [key: string]: string } = {};
  headers.forEach((value: string, key: string) => {
    headersArr[key] = { Value: [value] };
    // headersArr[key] = { Value: value };
  });
  return headersArr;
}

function fromHeadersToHeadersInit(headers: Headers) {
  const headersArr: { [key: string]: string } = {};
  headers.forEach((value, key) => {
    headersArr[key] = value;
  });
  return headersArr;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interceptor.on("request", (request, requestId) => {
  if (
    getExecutionContext() == undefined ||
    getExecutionContext().context == undefined
  ) {
    console.error(
      "keploy context [httpInterceptor-request] is not present to mock dependencies"
    );
    return;
  }
  const ctx = getExecutionContext().context;
  console.log("ctx.mode at .on('request')", ctx.mode);

  // to-do: name the interceptor based on the request
  const meta = {
    name: "node-fetch",
    url: request.url,
    // options: options,
    type: "HTTP_CLIENT",
  };

  switch (ctx.mode) {
    case MODE_TEST:
      const outputs = new Array(2);
      if (
        ctx.mocks != undefined &&
        ctx.mocks.length > 0 &&
        ctx.mocks[0].Kind == HTTP
      ) {
        const header: { [key: string]: string[] } = {};
        for (const k in ctx.mocks[0].Spec?.Res?.Header) {
          header[k] = ctx.mocks[0].Spec?.Res?.Header[k]?.Value;
        }
        outputs[1] = {
          headers: getHeadersInit(header),
          status: ctx.mocks[0].Spec.Res.StatusCode,
          statusText: getReasonPhrase(ctx.mocks[0].Spec.Res.StatusCode),
        };
        outputs[0] = [ctx.mocks[0].Spec.Res.Body];
        if (ctx?.fileExport) {
          console.log(
            "🤡 Returned the mocked outputs for Http dependency call with meta: ",
            meta
          );
        }
        ctx.mocks.shift();
      } else {
        ProcessDep({}, outputs);
      }

      const buf: Buffer[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outputs[0].map((el: any) => {
        buf.push(Buffer.from(el));
      });

      const bodyInit = Buffer.concat(buf);

      const formattedHeaders: { [key: string]: string } = {};
      for (const key in outputs[1].headers) {
        formattedHeaders[key] = outputs[1].headers[key];
      }

      const responseInit: ResponseInit = {
        // or new Headers(formattedHeaders), all is accepted by NodeJS Response
        headers: formattedHeaders,
        status: outputs[1].status,
        statusText: outputs[1].statusText,
      };
      // console.log("formattedHeaders", responseInit.headers);

      const resp = new Response(bodyInit, responseInit);
      request.respondWith(resp);

      // This is the only way I could get it to work.
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
    console.log(
      "keploy context [httpInterceptor-response] is not present to mock dependencies"
    );
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
      // When you use request.respondWith(), it will also get here.
      break;
    case MODE_RECORD:
      // Unsure if I need to clone
      const clonedResp = response.clone();
      const clonedReq = request.clone();

      // Using .json() => Unexpected token in JSON at position 0
      const reqBody = await clonedReq.text();
      const resBody = await clonedResp.text();

      // console.log("reqBody", reqBody);
      // console.log("resBody", resBody);

      // to-do: What's the type of this?
      const rinit: ResponseInit = {
        // #test
        headers: fromHeadersToHeadersInit(clonedResp.headers),
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
            Body: reqBody,
            Header: fromHeadersToKeploy(request.headers),
            Method: request.method,
            // URLParams:
          },
          Res: {
            StatusCode: clonedResp.status,
            Header: getResponseHeader(rinit.headers),
            Body: resBody,
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
        res.push({ Bin: stringToBinary(JSON.stringify(resBody)) });
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
