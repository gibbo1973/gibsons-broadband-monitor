setup_runtime() {
    ynh_setup_source --dest_dir="$install_dir" --full_replace --keep=".env .backup"
    ynh_setup_source --source_id=speedtest --dest_dir="$install_dir/bin"
    chmod 755 "$install_dir/bin/speedtest-go"
    chown -R "$app:$app" "$install_dir" "$data_dir"
    ynh_exec_as_app python3 -m venv "$install_dir/venv"
    ynh_exec_as_app "$install_dir/venv/bin/pip" install --no-cache-dir -r "$install_dir/requirements.txt"
}

configure_service() {
    ynh_config_add --template=".env" --destination="$install_dir/.env"
    chmod 600 "$install_dir/.env"
    chown "$app:$app" "$install_dir/.env"
    ynh_config_add_nginx
    ynh_config_add_systemd
    yunohost service add "$app" --description="Broadband connection monitor"
}
