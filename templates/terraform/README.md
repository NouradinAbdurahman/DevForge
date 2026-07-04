# Terraform starter template

A minimal, working Terraform configuration - copy this directory out and
adapt it. It deliberately uses the `local` provider so `terraform init &&
terraform apply` works with zero cloud credentials, as a template you can
extend with a real provider (AWS, GCP, etc.).

## Recommended structure

```text
terraform-app/
├── main.tf
├── variables.tf
├── outputs.tf
├── versions.tf
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
terraform init
terraform plan
terraform apply
```

This writes a local file (path controlled by `var.output_path`) containing
`var.content` - proof the plan/apply cycle works before you swap in a real
provider.

## Example configuration

`versions.tf` pins the Terraform and provider version constraints;
`variables.tf` declares inputs with defaults; `outputs.tf` surfaces the
written file's path.
