/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * ElasticSearch Emitter. Store Request/Response records in Elasticsearch
 */
import Debug from "debug";
import moment from "moment";
import request from "request";

import { SwsUtil } from "./swsUtil";

const indexTemplate = require("../schema/elasticsearch/api_index_template.json");
const indexTemplate7X = require("../schema/elasticsearch/api_index_template_7x.json");

const ES_MAX_BUFF = 50;

interface Options {
  url: string;
  json: boolean;
  key: string;
  cert: string;
  auth?: {
    username: string;
    password: string;
  };
}

// ElasticSearch Emitter. Store Request/Response records in Elasticsearch
export class SwsElasticEmitter {
  private debug = Debug("sws:elastic");

  private options = null;

  private es7 = true;

  private indexBuffer = "";

  private bufferCount = 0;

  private lastFlush = 0;

  private elasticURL: string;

  private elasticURLBulk: string;

  private elasticProto = null;

  private elasticHostname = null;

  private elasticPort = null;

  private elasticUsername = null;

  private elasticPassword = null;

  private elasticsearchCert: string;

  private elasticsearchKey: string;

  private indexPrefix = "api-";

  private enabled = false;

  // Initialize
  public initialize(swsOptions): void {
    if (typeof swsOptions === "undefined") return;
    if (!swsOptions) return;

    this.options = swsOptions;

    // Set or detect hostname
    if (!(SwsUtil.supportedOptions.elasticsearch in swsOptions)) {
      this.debug("Elasticsearch is disabled");
      return;
    }

    this.elasticURL = swsOptions[SwsUtil.supportedOptions.elasticsearch];

    if (!this.elasticURL) {
      this.debug("Elasticsearch url is invalid");
      return;
    }

    this.elasticURLBulk = `${this.elasticURL}/_bulk`;

    if (SwsUtil.supportedOptions.elasticsearchIndexPrefix in swsOptions) {
      this.indexPrefix =
        swsOptions[SwsUtil.supportedOptions.elasticsearchIndexPrefix];
    }

    if (SwsUtil.supportedOptions.elasticsearchUsername in swsOptions) {
      this.elasticUsername =
        swsOptions[SwsUtil.supportedOptions.elasticsearchUsername];
    }

    if (SwsUtil.supportedOptions.elasticsearchPassword in swsOptions) {
      this.elasticPassword =
        swsOptions[SwsUtil.supportedOptions.elasticsearchPassword];
    }

    if (SwsUtil.supportedOptions.elasticsearchCert in swsOptions) {
      this.elasticsearchCert =
        swsOptions[SwsUtil.supportedOptions.elasticsearchCert];
    }

    if (SwsUtil.supportedOptions.elasticsearchKey in swsOptions) {
      this.elasticsearchKey =
        swsOptions[SwsUtil.supportedOptions.elasticsearchKey];
    }

    // Check / Initialize schema
    this.initTemplate();

    this.enabled = true;
  }

  // initialize index template
  public initTemplate(): void {
    const that = this;

    const requiredTemplateVersion = indexTemplate7X.version;

    // Check if there is a template
    const templateURL = `${this.elasticURL}/_template/template_api`;
    const getOptionsVersion: Options = {
      url: this.elasticURL,
      json: true,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };
    const getOptions: Options = {
      url: templateURL,
      json: true,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };
    const putOptions: Options = {
      url: templateURL,
      json: indexTemplate7X,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };

    if (this.elasticUsername && this.elasticPassword) {
      const auth = {
        username: this.elasticUsername,
        password: this.elasticPassword,
      };
      getOptionsVersion.auth = auth;
      getOptions.auth = auth;
      putOptions.auth = auth;
    }

    request.get(getOptionsVersion, (error1, _, body1) => {
      if (error1) {
        this.debug("Error getting version:", JSON.stringify(error1));
      } else {
        if (body1 && "version" in body1 && "number" in body1.version) {
          that.es7 = body1.version.number.startsWith("7");
        }

        if (!that.es7) {
          putOptions.json = indexTemplate;
        }

        request.get(getOptions, (error2, response2, body2) => {
          if (error2) {
            this.debug("Error querying template:", JSON.stringify(error2));
          } else {
            let initializeNeeded = false;

            if (response2.statusCode === 404) {
              initializeNeeded = true;
            } else if (response2.statusCode === 200) {
              if ("template_api" in body2) {
                if (
                  !("version" in body2.template_api) ||
                  body2.template_api.version < requiredTemplateVersion
                ) {
                  initializeNeeded = true;
                }
              }
            }

            if (initializeNeeded) {
              request.put(putOptions, (error3) => {
                if (error3) {
                  this.debug(
                    "Failed to update template:",
                    JSON.stringify(error3),
                  );
                }
              });
            }
          }
        });
      }
    });
  }

  // Update timeline and stats per tick
  public tick(ts): void {
    // Flush if buffer is not empty and not flushed in more than 1 second
    if (this.bufferCount > 0 && ts - this.lastFlush >= 1000) {
      this.flush();
    }
  }

  // Pre-process RRR
  private preProcessRecord(rrr): void {
    // handle custom attributes
    if ("attrs" in rrr) {
      const { attrs } = rrr;
      // eslint-disable-next-line no-restricted-syntax
      for (const attrname of Object.keys(attrs)) {
        attrs[attrname] = SwsUtil.swsStringValue(attrs[attrname]);
      }
    }

    if ("attrsint" in rrr) {
      const intattrs = rrr.attrsint;
      // eslint-disable-next-line no-restricted-syntax
      for (const intattrname of Object.keys(intattrs)) {
        intattrs[intattrname] = SwsUtil.swsNumValue(intattrs[intattrname]);
      }
    }
  }

  // Index Request Response Record
  public processRecord(rrr): void {
    if (!this.enabled) {
      return;
    }

    this.preProcessRecord(rrr);

    // Create metadata
    const indexName =
      this.indexPrefix + moment(rrr["@timestamp"]).utc().format("YYYY.MM.DD");

    let meta: { index: { _index: string; _id: string; _type?: string } } = {
      index: { _index: indexName, _id: rrr.id },
    };
    if (!this.es7) {
      meta = { index: { _index: indexName, _type: "api", _id: rrr.id } };
    }

    // Add to buffer
    this.indexBuffer += `${JSON.stringify(meta)}\n`;
    this.indexBuffer += `${JSON.stringify(rrr)}\n`;

    this.bufferCount += 1;

    if (this.bufferCount >= ES_MAX_BUFF) {
      this.flush();
    }
  }

  private flush(): void {
    if (!this.enabled) {
      return;
    }

    this.lastFlush = Date.now();

    const options = {
      url: this.elasticURLBulk,
      headers: {
        "Content-Type": "application/x-ndjson",
      },
      body: this.indexBuffer,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };

    if (this.elasticUsername && this.elasticPassword) {
      options.auth = {
        username: this.elasticUsername,
        password: this.elasticPassword,
      };
    }

    request.post(options, (error, response) => {
      if (error) {
        this.debug("Indexing Error:", JSON.stringify(error));
      }
      if (response && "statusCode" in response && response.statusCode !== 200) {
        this.debug(
          "Indexing Error: %d %s",
          response.statusCode,
          response.message,
        );
      }
    });

    this.indexBuffer = "";
    this.bufferCount = 0;
  }
}
