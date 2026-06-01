fetch-spec:
  curl -s https://git.profidev.io/swagger.v1.json > forgejo/full-spec.json

filter-spec:
  npx openapi-format forgejo/full-spec.json --output forgejo/filtered-spec.json -f forgejo/filter.yaml

cleanup-spec:
  npx @redocly/cli bundle forgejo/filtered-spec.json --output forgejo/spec.json --remove-unused-components

create-client:
  npx openapi-ts

client: fetch-spec filter-spec cleanup-spec create-client
  echo "Client generated successfully!"
