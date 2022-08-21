/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * ElasticSearch Emitter. Store Request/Response records in Elasticsearch
 */

const request = require("request");

const debug = require("debug")("sws:elastic");
const moment = require("moment");
const swsUtil = require("./swsUtil.js");

const indexTemplate = require("../schema/elasticsearch/api_index_template.json");
const indexTemplate7X = require("../schema/elasticsearch/api_index_template_7x.json");

const ES_MAX_BUFF = 50;

// ElasticSearch Emitter. Store Request/Response records in Elasticsearch
class SwsElasticEmitter {
  constructor() {
    // Options
    this.options = null;

    this.es7 = true;

    this.indexBuffer = "";
    this.bufferCount = 0;
    this.lastFlush = 0;

    this.elasticURL = null;
    this.elasticURLBulk = null;
    this.elasticProto = null;
    this.elasticHostname = null;
    this.elasticPort = null;

    this.elasticUsername = null;
    this.elasticPassword = null;

    this.elasticsearchCert = null;
    this.elasticsearchKey = null;

    this.indexPrefix = "api-";

    this.enabled = false;
  }

  // Initialize
  initialize(swsOptions) {
    if (typeof swsOptions === "undefined") return;
    if (!swsOptions) return;

    this.options = swsOptions;

    // Set or detect hostname
    if (!(swsUtil.supportedOptions.elasticsearch in swsOptions)) {
      debug("Elasticsearch is disabled");
      return;
    }

    this.elasticURL = swsOptions[swsUtil.supportedOptions.elasticsearch];

    if (!this.elasticURL) {
      debug("Elasticsearch url is invalid");
      return;
    }

    this.elasticURLBulk = `${this.elasticURL}/_bulk`;

    if (swsUtil.supportedOptions.elasticsearchIndexPrefix in swsOptions) {
      this.indexPrefix =
        swsOptions[swsUtil.supportedOptions.elasticsearchIndexPrefix];
    }

    if (swsUtil.supportedOptions.elasticsearchUsername in swsOptions) {
      this.elasticUsername =
        swsOptions[swsUtil.supportedOptions.elasticsearchUsername];
    }

    if (swsUtil.supportedOptions.elasticsearchPassword in swsOptions) {
      this.elasticPassword =
        swsOptions[swsUtil.supportedOptions.elasticsearchPassword];
    }

    if (swsUtil.supportedOptions.elasticsearchCert in swsOptions) {
      this.elasticsearchCert =
        swsOptions[swsUtil.supportedOptions.elasticsearchCert];
    }

    if (swsUtil.supportedOptions.elasticsearchKey in swsOptions) {
      this.elasticsearchKey =
        swsOptions[swsUtil.supportedOptions.elasticsearchKey];
    }

    // Check / Initialize schema
    this.initTemplate();

    this.enabled = true;
  }

  // initialize index template
  initTemplate() {
    const that = this;

    const requiredTemplateVersion = indexTemplate7X.version;

    // Check if there is a template
    const templateURL = `${this.elasticURL}/_template/template_api`;
    const getOptionsVersion = {
      url: this.elasticURL,
      json: true,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };
    const getOptions = {
      url: templateURL,
      json: true,
      key: this.elasticsearchKey,
      cert: this.elasticsearchCert,
    };
    const putOptions = {
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
        debug("Error getting version:", JSON.stringify(error1));
        // eslint-disable-next-line no-unused-expressions
        that.enabled.false;
      } else {
        if (body1 && "version" in body1 && "number" in body1.version) {
          that.es7 = body1.version.number.startsWith("7");
        }

        if (!that.es7) {
          putOptions.json = indexTemplate;
        }

        request.get(getOptions, (error2, response2, body2) => {
          if (error2) {
            debug("Error querying template:", JSON.stringify(error2));
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
                  debug("Failed to update template:", JSON.stringify(error3));
                }
              });
            }
          }
        });
      }
    });
  }

  // Update timeline and stats per tick
  tick(ts) {
    // Flush if buffer is not empty and not flushed in more than 1 second
    if (this.bufferCount > 0 && ts - this.lastFlush >= 1000) {
      this.flush();
    }
  }

  // Pre-process RRR
  preProcessRecord(rrr) {
    // handle custom attributes
    if ("attrs" in rrr) {
      const { attrs } = rrr;
      // eslint-disable-next-line no-restricted-syntax
      for (const attrname of Object.keys(attrs)) {
        attrs[attrname] = swsUtil.swsStringValue(attrs[attrname]);
      }
    }

    if ("attrsint" in rrr) {
      const intattrs = rrr.attrsint;
      // eslint-disable-next-line no-restricted-syntax
      for (const intattrname of Object.keys(intattrs)) {
        intattrs[intattrname] = swsUtil.swsNumValue(intattrs[intattrname]);
      }
    }
  }

  // Index Request Response Record
  processRecord(rrr) {
    if (!this.enabled) {
      return;
    }

    this.preProcessRecord(rrr);

    // Create metadata
    const indexName =
      this.indexPrefix + moment(rrr["@timestamp"]).utc().format("YYYY.MM.DD");

    let meta = { index: { _index: indexName, _id: rrr.id } };
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

  flush() {
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
        debug("Indexing Error:", JSON.stringify(error));
      }
      if (response && "statusCode" in response && response.statusCode !== 200) {
        debug("Indexing Error: %d %s", response.statusCode, response.message);
      }
    });

    this.indexBuffer = "";
    this.bufferCount = 0;
  }
}

module.exports = SwsElasticEmitter;
