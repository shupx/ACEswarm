# ACEswarm Design Philosophy

ACEswarm provides a minimal platform for independently developed apps to run, work together, and become reusable software assets.

## 1. Modularity: Independent Microfrontends and Microbackends

ACEswarm provides only a few essential apps and shared capabilities, including unified app installation and version management. Business features and algorithms are delivered as independent apps, each combining an optional microfrontend, a microbackend, a parameter config file, and installation scripts as needed.

- The microfrontend is just a static web page that provides the app's web interface at an independent address managed by the platform. 

- The microbackend is just a script that starts through the app's declared entrypoint when the user clicks Run. That script can launch local processes, algorithm services, or other runtime environments; ACEswarm leaves its contents, languages, and frameworks to the app developer. 

- The parameter config file declares the app's configurable parameters and their schema, which the platform uses to provide a unified configuration panel.

- Apps can also provide installation and uninstallation scripts to prepare their dependencies and uninstallation procedures.

The app package contract centers on a compliant `manifest.yaml`; the rest of the package layout is up to the app. For example:

```yaml
app_id: robot-navigation
name: Robot Navigation
description: Navigation service and control UI
version: 1.0.0
run:
  entrypoint: ./start.sh
ui_index_path: ui/index.html
default_config_path: config/default_config.yaml
config_schema_path: config/config_schema.yaml
pre_install: scripts/pre_install.sh
```

`run.entrypoint` points to the backend startup script, `ui_index_path` to the frontend's static homepage (optional), and `default_config_path` and `config_schema_path` to the parameter file and its schema. These referenced files are included in the package. See [AivudaOS App Management](../aivudaOS/docs/app-management.md) for the complete package specification.

## 2. App Relationships: Communication and Shared Parameters

Independent apps only connect through three mechanisms: frontend communication, backend communication, and shared parameters.

- Most apps' frontends are independent and do not require a shared frontend. 
For apps that need a shared frontend, the optional `panelhub` app automatically discovers compatible installed app frontends and uses the micro-frontend framework [qiankun](https://qiankun.umijs.org/) to mount them into a single page, with `mitt` for event communication. Apps can use this integration when they need to work together in one interface. 

- For microbackends, the platform does not provide a shared RPC or message bus. Each app can use an appropriate communication mechanism, such as ROS 2, HTTP, or sockets. ACEswarm does not impose a particular IPC framework or protocol.

- ACEswarm also provides a unified parameter configuration panel through AivudaOS. Apps declare their parameters and schemas so users can configure them in one place. The **magnetic parameters** concept automatically links parameters with the same full name (configuration path) across active apps and keeps their stored values consistent. For example, apps sharing `sys.robot_type` can use a single shared value instead of requiring users to edit each app separately. Matching parameters must have compatible schemas; incompatible definitions are reported as conflicts. Apps should therefore use the same parameter name for the same meaning.

## 3. Independent Apps with Minimal Connections Enable Reuse

Independent apps, connected only through the frontend, backend, and parameter relationships they need, can evolve without requiring changes to the whole platform. Developers and AI can focus on one app, validate it independently, and publish versioned results to AppStore. Algorithm prototypes become installable, reusable assets that later work can improve rather than recreate.

The same app contract supports ground station apps running on the ACEswarm host and onboard apps deployed to a robot's AivudaOS. Ground station tools can handle monitoring, configuration, and visualization while onboard apps run perception, planning, and control. Packaging and version management follow a common model, with artifacts prepared for each target's hardware and dependencies.

This gives developers and AI a clear iteration loop: develop, package, publish, install, run, and improve. Unified installation, version management, and the necessary connections between apps allow useful algorithms and tools to accumulate while keeping the platform small.
