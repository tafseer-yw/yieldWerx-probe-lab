# Local Jenkins for the PROBE Lab — runs the full pipeline in-container, so the
# only host requirement is Docker. Based on the LTS image plus Node (to run the
# suite), build-essential (better-sqlite3 compiles from source for this arch),
# the Playwright system libraries, and the Allure CLI (report generation).
FROM jenkins/jenkins:lts-jdk21

USER root

# Node 22 (repo engines: >=22.18), a build toolchain, and git.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update && apt-get install -y --no-install-recommends nodejs build-essential git rsync \
  && rm -rf /var/lib/apt/lists/*

# Allure CLI (report generation in the pipeline). Java is already present.
ENV ALLURE_VERSION=2.34.1
RUN curl -fsSL -o /tmp/allure.tgz https://github.com/allure-framework/allure2/releases/download/${ALLURE_VERSION}/allure-${ALLURE_VERSION}.tgz \
  && tar -xzf /tmp/allure.tgz -C /opt \
  && ln -s /opt/allure-${ALLURE_VERSION}/bin/allure /usr/local/bin/allure \
  && rm /tmp/allure.tgz

# Playwright's system libraries, so `npx playwright install chromium` has a
# browser that actually launches. Pinned to the version in package.json.
USER jenkins
RUN npx --yes playwright@1.61.1 install-deps chromium 2>/dev/null || true
USER root
RUN npx --yes playwright@1.61.1 install-deps chromium

# Skip the setup wizard; JCasC configures everything.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
ENV CASC_JENKINS_CONFIG=/var/jenkins_conf/casc.yaml
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

USER jenkins
