# The feed keeper, for any always-on host.
#
# GitHub runs scheduled workflows on a best-effort basis: mirror-feeds.yml is set for every thirty
# minutes and in practice runs every few hours, while the sequencer feed reads down 100 minutes after
# its last report (AUDIT-29). This runs the same script in a loop instead.
#
#   docker build -f keeper/Dockerfile -t aarka-keeper .
#   docker run -e PRIVATE_KEY=<FEED_KEEPER_KEY> aarka-keeper
#
# On Railway: deploy from the repo with this Dockerfile and set PRIVATE_KEY as a variable. The key is
# the feed keeper's, which owns only the two testnet stand-in feeds and reports the sequencer feeds.
FROM ghcr.io/foundry-rs/foundry:stable
USER root
RUN if command -v apt-get >/dev/null; then \
      apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; \
    else apk add --no-cache python3 bash; fi
WORKDIR /keeper
COPY script/mirror-feeds.sh .
ENV LOOP=1800
ENTRYPOINT ["/bin/bash", "mirror-feeds.sh"]
