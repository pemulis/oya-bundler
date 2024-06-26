# Oya Bundler

Express application written in Node.js for the bundler.

This accepts signed natural language intentions from account holders, and signed bundles from the bundler, which include proof of execution. It also exposes an API for finding the latest bundle and historical bundle information, to simplify frontend integration and optimistic oracle verification.

The Oya layer three "virtual chain" is composed of a series of bundles published by the bundler, along with any manual transactions executed by account holders, validated and finalized by the optimistic oracle. Each new bundle must reflect the virtual state changes from earlier bundles and manual transactions.
