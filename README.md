<h1 align="center">Relay</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Bun-black?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" />
</p>

<p align="center">
  <img src="./preview.png" alt="Preview" width="100%" />
</p>

Relay is a high-performance web interface designed for browsing, streaming, and downloading files directly from your TorBox cloud storage. It works in tandem with a specialized local daemon to bypass browser constraints, handing off media streams directly to native desktop players for an optimal, high-quality playback experience.

## Environment Configuration

Before attempting to run the application locally, you must configure the environment variables. Please refer to `.env.example` in the root directory for the exact keys required. **You must create and fill up your own `.env` file for the application to function correctly.**

- `TMDB_API_KEY`: Used to fetch rich metadata for movies and TV shows.
- `SESSION_SECRET`: The secret key utilized to encrypt session cookies.
- `TB_SB_ANON_KEY`: The Supabase GoTrue anonymous key required for TorBox API authentication.

## Running the Application

There are currently only three official ways to run Relay. 

**Note: There is no Docker implementation available to run this application at this time.**

To utilize local playback features in any of the setups below, you must download and run the Aemond local daemon on your host machine. You can find the daemon repository here: [Sn3hil/relay-aemond](https://github.com/Sn3hil/webdoma-aemond)

### 1. Hosted Instance with Local Daemon

The most straightforward method is to use the official hosted instance alongside your local daemon.

- Visit the live application: [https://relay.kshiyo.dpdns.org/](https://relay.kshiyo.dpdns.org/)
- Clone, build, and run the `relay-aemond` daemon on your local machine.
- The web application will securely communicate with your local daemon to launch media players.

### 2. Independent Local Setup

If you wish to host the web interface locally, you can run the application and the daemon as two separate processes.

- Clone this repository and install the dependencies using Bun.
- Create and fill up your `.env` file based on `.env.example`.
- Start the development server using Bun.
- Clone and start the `relay-aemond` daemon separately on your machine.
- Access the local web interface to interact with your TorBox storage.

- Clone the orchestrator repository: [shubham-021/relay-orch](https://github.com/shubham-021/relay-orch)
- Install the workspace dependencies.
- Ensure all necessary environment variables are filled out in the project.
- Launch both the site and the daemon with a single command.
