import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Component } from '@nestjs/common';
import { JobLoggerFactory } from '../../logger/job-logger-factory';
import { Config } from '../../config/config.component';
import { BuildInstanceRepository } from '../../persistence/repository/build-instance.repository';
import { BuildJobInterface, JobInterface } from './job';
import { JobExecutorInterface } from './job-executor';

const BUFFER_SIZE = 1048576; // 1M

export class ProxyPortDomainsJob implements BuildJobInterface {

    constructor(
        readonly build: any,
    ) {}

}

@Component()
export class ProxyPortDomainsJobExecutor implements JobExecutorInterface {

    constructor(
        private readonly config: Config,
        private readonly jobLoggerFactory: JobLoggerFactory,
        private readonly buildInstanceRepository: BuildInstanceRepository,
    ) {}

    supports(job: JobInterface): boolean {
        return (job instanceof ProxyPortDomainsJob);
    }

    execute(job: JobInterface, data: any): Promise<any> {
        if (!this.supports(job)) {
            throw new Error();
        }

        const buildJob = job as ProxyPortDomainsJob;
        const logger = this.jobLoggerFactory.createForBuildJob(buildJob);
        const { build } = buildJob;

        return new Promise(resolve => {
            logger.info('Proxying port domains.');

            const nginxConfs = [];

            for (const serviceId of Object.keys(build.services)) {
                const service = build.services[serviceId];

                for (const exposedPort of service.exposedPorts) {
                    for (const domainType of Object.keys(exposedPort.proxyDomains)) {

                        nginxConfs.push(
`
# Proxy domain for port ${exposedPort.port} of ${serviceId} running at ${service.ipAddress}
server {
listen 80;
server_name ${exposedPort.proxyDomains[domainType]};

location / {
    proxy_pass http://${service.ipAddress}:${exposedPort.port};
    proxy_set_header Host $host:${this.config.app.proxyPort};
}
}
`,
                        );

                    }
                }
            }

            fs.writeFileSync(
                path.join(this.config.guestPaths.proxyDomain, `build-${build.hash}.conf`),
                nginxConfs.join('\n\n'),
            );

            execSync(
                `docker exec -t feat_nginx /etc/init.d/nginx restart`,
                { maxBuffer: BUFFER_SIZE },
            );

            this.buildInstanceRepository
                .updateServices(build)
                .then(resolve);
        });
    }
}
