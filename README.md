# tp-web-tr

## This project include the protocol describe below

To start the project proceed to install packages with your favorite package manager:
```sh
- npm i
- bun i
- yarn i
```
You can use the shared folder as a library or start the demo server in /src/app.
The server listen to port 3000 by default and you need to set his IP/URL for him to work properly.


### Protocol Specs
The protocol specs can be found in this document: `protocol-specs.md`

### Env
The env needs to be created with the schema presented in the `.env.exemple`


### Here is how to start the demo
```sh
bun i
bun run src/app.ts  # Server 1
bun run src/demo.ts # Server 2 + demo
```

