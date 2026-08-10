const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";
const DEFAULT_GRAPHQL_VERSION = "2025-04-16";

const marketConfigs = {
  slc: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_SLC",
  },
  ut: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_SLC",
  },
  stl: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_STL",
  },
  mo_stl: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_STL",
  },
  kc: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_KC",
  },
  mo_kc: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN_KC",
  },
  general: {
    accessTokenEnvKey: "JOBBER_ACCESS_TOKEN",
  },
};

const INSPECTION_QUERY = `
  query InspectJobberLeadSchema {
    clientCreateInput: __type(name: "ClientCreateInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    requestCreateInput: __type(name: "RequestCreateInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    propertyCreateInput: __type(name: "PropertyCreateInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    propertyAttributes: __type(name: "PropertyAttributes") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    addressAttributes: __type(name: "AddressAttributes") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    assessmentCreateInput: __type(name: "AssessmentCreateInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    requestDetailsInput: __type(name: "RequestDetailsInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    requestCreateNoteInput: __type(name: "RequestCreateNoteInput") {
      name
      inputFields {
        name
        type {
          ...TypeRef
        }
      }
    }
    clientCreatePayload: __type(name: "ClientCreatePayload") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    propertyCreatePayload: __type(name: "PropertyCreatePayload") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    requestCreatePayload: __type(name: "RequestCreatePayload") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    clientType: __type(name: "Client") {
      name
      fields {
        name
        args {
          name
          type {
            ...TypeRef
          }
        }
        type {
          ...TypeRef
        }
      }
    }
    propertyType: __type(name: "Property") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    propertyConnectionType: __type(name: "PropertyConnection") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    requestType: __type(name: "Request") {
      name
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
    mutationFields: __schema {
      mutationType {
        fields {
          name
          args {
            name
            type {
              ...TypeRef
            }
          }
        }
      }
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function formatType(type) {
  if (!type) return "";
  if (type.kind === "NON_NULL") return `${formatType(type.ofType)}!`;
  if (type.kind === "LIST") return `[${formatType(type.ofType)}]`;
  return type.name || type.kind || "";
}

async function inspectSchema(accessToken) {
  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": process.env.JOBBER_GRAPHQL_VERSION?.trim() || DEFAULT_GRAPHQL_VERSION,
    },
    body: JSON.stringify({ query: INSPECTION_QUERY }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.errors?.length) {
    throw new Error(`Jobber schema inspection failed with status ${response.status}: ${JSON.stringify(data)}`);
  }

  return data.data;
}

function printInputType(type) {
  console.log(`\n${type?.name || "Unavailable"}`);
  if (!type?.inputFields?.length) {
    console.log("- Not available in this schema/version.");
    return;
  }

  for (const field of type.inputFields) {
    console.log(`- ${field.name}: ${formatType(field.type)}`);
  }
}

function printObjectType(type) {
  console.log(`\n${type?.name || "Unavailable"}`);
  if (!type?.fields?.length) {
    console.log("- Not available in this schema/version.");
    return;
  }

  for (const field of type.fields) {
    const args = field.args?.length
      ? `(${field.args.map((arg) => `${arg.name}: ${formatType(arg.type)}`).join(", ")})`
      : "";
    console.log(`- ${field.name}${args}: ${formatType(field.type)}`);
  }
}

function printRelevantMutations(schema) {
  const mutationFields = schema?.mutationFields?.mutationType?.fields || [];
  const relevant = mutationFields
    .filter((field) => /client|request|propert|note/i.test(field.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log("\nRelevant mutations");
  if (!relevant.length) {
    console.log("- No matching mutations found.");
    return;
  }

  for (const field of relevant) {
    const args = field.args.map((arg) => `${arg.name}: ${formatType(arg.type)}`).join(", ");
    console.log(`- ${field.name}(${args})`);
  }
}

async function main() {
  const market = (process.argv[2] || "kc").toLowerCase();
  const config = marketConfigs[market];
  if (!config) {
    throw new Error(`Unknown market "${market}". Use one of: ${Object.keys(marketConfigs).join(", ")}`);
  }

  const accessToken = process.env[config.accessTokenEnvKey]?.trim()
    || requiredEnv("JOBBER_ACCESS_TOKEN");
  const schema = await inspectSchema(accessToken);

  console.log(`Jobber schema inspection using ${config.accessTokenEnvKey}`);
  printInputType(schema.clientCreateInput);
  printInputType(schema.requestCreateInput);
  printInputType(schema.propertyCreateInput);
  printInputType(schema.propertyAttributes);
  printInputType(schema.addressAttributes);
  printInputType(schema.assessmentCreateInput);
  printInputType(schema.requestDetailsInput);
  printInputType(schema.requestCreateNoteInput);
  printObjectType(schema.clientCreatePayload);
  printObjectType(schema.propertyCreatePayload);
  printObjectType(schema.requestCreatePayload);
  printObjectType(schema.clientType);
  printObjectType(schema.propertyType);
  printObjectType(schema.propertyConnectionType);
  printObjectType(schema.requestType);
  printRelevantMutations(schema);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
