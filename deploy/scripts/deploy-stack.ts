import * as aws from "aws-sdk";
import * as inquirer from "inquirer";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);

const ENVIRONMENTS = ["dev"];
const REGION = "us-west-2";

async function run() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const appName = packageJson.name;

  const stacks = await getStacks();

  const answers = await inquirer.prompt([
    {
      type: "list",
      message: "Which environment should be updated",
      name: "environment",
      choices: ENVIRONMENTS
    },
    {
      type: "list",
      message: (answers: any) =>
        `Which stack should be deployed to "${answers.environment}"`,
      name: "stack",
      choices: stacks
    },
    {
      type: "confirm",
      message: (answers: any) =>
        `Do you want to deploy the "${answers.stack}" stack to "${
          answers.environment
        }"`,
      default: false,
      name: "confirm"
    }
  ]);

  if (!answers.confirm) {
    console.log("Deployment cancelled.");
    return;
  }

  const stackName = makeStackName(appName, answers.environment, answers.stack);

  const cf = new aws.CloudFormation({ region: REGION });

  let existingStack = true;
  try {
    await cf.describeStacks({ StackName: stackName }).promise();
  } catch (e) {
    if (e.code === "ValidationError" && e.message.includes("does not exist"))
      existingStack = false;
    else throw e;
  }

  if (existingStack) {
    await cf
      .updateStack({
        StackName: stackName,
        TemplateBody: await readFile(
          path.join("deploy/stacks", `${answers.stack}.yaml`),
          "utf8"
        ),
        Parameters: getParameters(appName, answers)
      })
      .promise();
  } else {
    await cf
      .createStack({
        StackName: stackName,
        TemplateBody: await readFile(
          path.join("deploy/stacks", `${answers.stack}.yaml`),
          "utf8"
        ),
        Parameters: getParameters(appName, answers)
      })
      .promise();
  }

  console.log("Deployment started.");
}

function getParameters(appName: string, answers: any) {
  const parameters = [
    {
      ParameterKey: "EnvironmentName",
      ParameterValue: answers.environment
    }
  ];

  if (answers.stack === "database") {
    parameters.push({
      ParameterKey: "MasterUsername",
      ParameterValue: process.env.DB_MASTER_USERNAME
    });
    parameters.push({
      ParameterKey: "MasterUserPassword",
      ParameterValue: process.env.DB_MASTER_USER_PASSWORD
    });
    parameters.push({
      ParameterKey: "NetworkStack",
      ParameterValue: makeStackName(appName, answers.environment, "network")
    });
  }

  return parameters;
}

function makeStackName(appName: string, environment: string, stack: string) {
  return `${appName}-${environment}-${stack}`;
}

async function getStacks() {
  const readdir = promisify(fs.readdir);
  const entries = await readdir("deploy/stacks");
  return entries
    .filter(entry => entry.endsWith(".yaml"))
    .map(entry => entry.substr(0, entry.length - 5));
}

run().catch(e => {
  console.log(e.stack || e);
  process.exit(1);
});
