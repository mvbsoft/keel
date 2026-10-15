# Development and eval container for keel: Linux, Node, git and Claude Code with its Bash sandbox
# (bubblewrap, socat), which `claude plugin eval` needs and native Windows lacks.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git bubblewrap socat ripgrep ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

# A normal user: the login and Claude Code's settings live in its home, kept in a named volume.
RUN useradd -m -s /bin/bash dev
USER dev
ENV HOME=/home/dev
WORKDIR /work
RUN git config --global user.name "keel dev" && git config --global user.email "dev@example.com" \
 && git config --global init.defaultBranch main && git config --global --add safe.directory '*'
CMD ["bash"]
