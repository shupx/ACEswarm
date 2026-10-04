# ACEswarm Design Philosophy

ACEswarm aims to provide a working environment where applications can be installed, run, and accumulated over time. Developers and AI can build an application independently, publish it to AppStore, and use it on a ground station or a robot. Algorithm improvements should become software assets that can be deployed again and reused.

## 1. Modularity: A Minimal Platform with Independent Apps

ACEswarm itself provides a few essential applications and shared capabilities. Business features and algorithms should generally be delivered as independent apps so that adding a feature does not require changing and releasing the entire ACEswarm platform.

An app can be understood as three parts:

| Part | Responsibility | Implementation freedom |
| --- | --- | --- |
| Microfrontend | Provides the app's web interface at its own address under shared platform management | May use any frontend framework or static pages; a background application may have no UI |
| Microbackend | Starts the application through its declared entrypoint when the user clicks Run | Typically uses `start.sh`, which can launch local processes, algorithm services, or other runtime environments |
| Installation and lifecycle scripts | Prepare dependencies and perform application-specific installation or removal tasks | Provided as needed, with internal steps defined by the application |

Here, "microfrontend" and "microbackend" describe independent delivery and execution. They do not require a particular microfrontend framework or microservice architecture. ACEswarm manages application entrypoints, installed versions, and lifecycles while leaving languages, frameworks, and business logic to each app.

Currently, the desktop uses a local AivudaOS instance for app management and Caddy for shared web entrypoints. For example, a packaged UI can be accessed at `/{app_id}/ui/`. The desktop presents these pages and manages their windows; each app owns its functionality.

For micro frontends to communicate with each other, we provide a app named `panelhub` that auto-detects micro frontends of the installed apps and uses [qiankun](https://qiankun.umijs.org/) to mount them into a single page and use `mitt` for event communication. The `panelhub` app is optional and can be used by any app that wants to integrate with other apps.

For micro backends, we do not provide a shared RPC or message bus. Each app can implement its own inter-process communication, such as ROS2, http, or sockets. The platform does not impose a particular IPC framework or protocol.

## 2. A Minimal Contract with Implementation Freedom

The central package contract is a valid `manifest.yaml`. The platform uses it to identify the application, version, startup entrypoint, UI, and lifecycle scripts. The application determines the rest of its directory structure.

A manifest alone is not enough for installation: required files referenced by it must exist and pass path, entrypoint, and configuration validation. `start.sh` is the recommended filename; `run.entrypoint` specifies the actual startup file. An installation script is declared through `pre_install` and does not have to be named `install.sh`.

The following example describes an app with a web UI and installation scripts:

```yaml
app_id: robot-navigation
name: Robot Navigation
description: Navigation service and control UI
version: 1.0.0
run:
  entrypoint: ./start.sh
  args: []
default_config_path: ./config/default_config.yaml
config_schema_path: ./config/config_schema.yaml
ui_index_path: ui/index.html
icon: assets/icon.png
pre_install: ./scripts/pre_install.sh
pre_uninstall: ./scripts/pre_uninstall.sh
```

The package files can be organized as follows:

```text
robot-navigation/
  manifest.yaml
  start.sh
  config/
    default_config.yaml
    config_schema.yaml
  ui/
    index.html
  assets/
    icon.png
  scripts/
    pre_install.sh
    pre_uninstall.sh
  ...
```

| Field | Contract |
| --- | --- |
| `app_id` | Required; a stable, unique application identifier shared across its versions |
| `name`, `description`, `version` | Explicitly provide the name, description, and version when delivering an app; semantic versioning is recommended |
| `run.entrypoint` | Required; points to an existing startup file inside the package |
| `run.args` | Optional list of startup arguments |
| `default_config_path`, `config_schema_path` | Required by the current AivudaOS installer; point to packaged default configuration and configuration schema files. An app without configuration fields can use empty YAML objects `{}` |
| `ui_index_path`, `icon` | Optional paths to the packaged UI homepage and icon |
| `pre_install`, `pre_uninstall` | Optional installation and removal lifecycle scripts |

An app may bundle all its dependencies or prepare its runtime environment through installation scripts. App developers are responsible for dependencies, startup behavior, and compatibility with the target platform. Independent execution does not automatically provide container isolation.

See [AivudaOS App Management](../aivudaOS/docs/app-management.md) for the full field definitions, script execution rules, and installation flow. This document describes design principles; the current installer implementation determines the actual validation rules.

## 3. Versioned Assets: Algorithms Become Reusable Apps

Algorithm prototypes, debugging tools, and business services can progressively become apps. Each reusable result is delivered with an explicit application identifier, version, configuration, and startup entrypoint, giving subsequent installation and execution a common foundation.

The recommended iteration flow is to develop and validate, package the app, publish a version to AppStore, install it in the target environment, verify its execution, and then publish the next version. AppStore stores and distributes application artifacts. AivudaOS manages installed versions, the active version, and runtime state. ACEswarm provides the ground station working environment.

Multiple installed versions and version switching let users select an appropriate release without replacing the entire desktop application for each algorithm update. Apps must still define their own data formats and migration strategies; switching software versions does not automatically guarantee that data can be rolled back.

The Online Store in Applications serves users browsing and installing apps. The desktop's store management application serves publishers uploading and managing releases.

## 4. A Shared App Contract for Ground Stations and Robots

The same delivery model should serve two environments: ground station apps running on the ACEswarm host and apps deployed to a robot's onboard AivudaOS. The ground station can provide monitoring, configuration, debugging, and visualization, while the robot can run perception, planning, and control algorithms.

A shared contract makes development, packaging, version management, and distribution practices reusable. Deployment or push workflows targeting robots should follow this contract rather than introduce a separate installation process for every algorithm.

A shared contract does not require one binary package to run on every device. CPU architectures, GPUs, system dependencies, and hardware interfaces may differ, so apps need suitable artifacts for their actual targets. Deployment across environments should account for these differences; a manifest alone does not establish compatibility.

## 5. AI-Friendly Development with Reusable Results

An independent app is a practical unit of collaboration for developers and AI: the input is a clear functional requirement and application contract, and the output is a versioned package that can be installed, started, and validated.

AI can choose implementation approaches within an app, modify algorithms, pages, configuration, and scripts, and validate the result through installation and execution. Once a mature version is published to AppStore, later tasks can reuse and improve it, preserving algorithm development as software assets.

To support this iteration, apps should provide clear configuration schemas, understandable logs, explicit interfaces, and verifiable runtime results. Platform automation interfaces can continue to evolve. This principle does not depend on a particular agent implementation or imply that ACEswarm currently provides a desktop agent control API.

## Design Tradeoffs

When adding a feature, first decide whether it belongs to shared platform capabilities or an app's business logic. Installation, versioning, lifecycles, shared entrypoints, and desktop window management belong to the platform. Specific algorithms, business interfaces, and specialized dependencies should generally stay within apps.

Consider moving a capability into the platform when multiple apps actually need it. This keeps the core small while allowing apps to evolve, ship, and be reused independently.

See [Architecture and Project Layout](architecture.md) for current module boundaries, [Runtime and Workspace](runtime.md) for runtime directories, and [Bundled Application Bootstrap](bootstrap.md) for the installation flow of essential apps distributed with the software.
