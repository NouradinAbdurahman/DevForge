variable "output_path" {
  description = "Path of the file this configuration writes (relative to where you run terraform)."
  type        = string
  default     = "output.txt"
}

variable "content" {
  description = "Content written to output_path."
  type        = string
  default     = "Hello, Terraform!"
}
