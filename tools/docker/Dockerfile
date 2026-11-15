# Development and eval container for keel: Linux, Node, git and Claude Code with its Bash sandbox
# (bubblewrap, socat), which `claude plugin eval` needs and native Windows lacks.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git bubblewrap socat ripgrep ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

# Pinned: a newer Claude Code changes how evals run, so it comes in on purpose, with an eval pass.
RUN npm install -g @anthropic-ai/claude-code@2.1.319 && npm cache clean --force
ENV DISABLE_AUTOUPDATER=1

# A normal user: the login and Claude Code's settings live in its home, kept in a named volume.
RUN useradd -m -s /bin/bash dev

# Since 2.1.316 the eval sandbox denies writes under /tmp, /var/tmp, /dev/shm and /run/shm, yet puts
# the run's temp folder under TMPDIR, so a skill that starts with a `!` line ends with 0 turns.
# Not the home folder: the home is a named volume, where folders made here do not appear.
RUN mkdir /scratch && chown dev:dev /scratch
ENV TMPDIR=/scratch

USER dev
ENV HOME=/home/dev
WORKDIR /work
RUN git config --global user.name "keel dev" && git config --global user.email "dev@example.com" \
 && git config --global init.defaultBranch main && git config --global --add safe.directory '*'
CMD ["bash"]
