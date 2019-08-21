#! /bin/bash
curl -X POST -H 'Content-Type:application/json' -d '{"attachments": [{"color": "warning", "fallback": "Build Notification: $TRAVIS_BUILD_WEB_URL", "title": "Kubernetes-Monitor Publish Notification", "text": ":egg: A new version is about to be published! :egg:\nhttps://github.com/$TRAVIS_PULL_REQUEST_SLUG/pull/$TRAVIS_PULL_REQUEST\nbranch of origin is $TRAVIS_PULL_REQUEST_BRANCH"}]}' $SLACK_WEBHOOK
